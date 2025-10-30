import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as semver from 'semver';
import * as dotenv from 'dotenv';
import * as fastGlob from 'fast-glob';
import fetch from 'node-fetch';
import { logger, utils, standardizePath as s } from './utils';
import { Octokit } from '@octokit/rest';
import { ChangelogGenerator } from './ChangeLogGenerator';
import { ProjectManager } from './ProjectManager';
import diffParse from 'parse-diff';


type ReleaseType = 'major' | 'minor' | 'patch' | 'prerelease';

/**
 * This class is responsible for managing the local git repository, GitHub PRs, and GitHub Releases
**/

export class ReleaseCreator {
    private octokit: Octokit;
    private ORG = 'rokucommunity';
    private temporaryBucketTagName = 'v0.0.0-packages';

    constructor() {
        dotenv.config();

        this.octokit = new Octokit({
            auth: process.env.GH_TOKEN,
            request: { fetch }
        });
    }

    /**
     * This method initializes a release by creating a new branch,
     * updating the changelog and version, creating a release pull request
     * and creating a GitHub release
     */
    public async initializeRelease(options: {
        projectName: string;
        releaseType: ReleaseType;
        branch: string;
        installDependencies: boolean;
        customVersion: string;
        testRun?: boolean;
    }) {
        logger.log(`Intialize release... releaseType: ${options.releaseType}, branch: ${options.branch}`);
        logger.increaseIndent();

        const project = await ProjectManager.initialize(options);

        logger.log(`Checking for a clean repository`);
        if (!utils.executeCommandSucceeds('git diff --quiet', { cwd: project.dir })) {
            utils.throwError('Repository is not clean', options);
        }

        logger.log(`Checkout branch ${options.branch}`);
        if (!utils.executeCommandSucceeds(`git checkout --quiet ${options.branch}`, { cwd: project.dir })) {
            utils.throwError(`Branch ${options.branch} does not exist`, options);
        }

        logger.log(`Fetch all branches`);
        if (!utils.executeCommandSucceeds(`git fetch --all --tags`, { cwd: project.dir })) {
            utils.throwError(`Failed to fetch origin`, options);
        }

        logger.log(`Get the incremented release version`);
        const releaseVersion = await this.getNewVersion(options.releaseType as ReleaseType, options.customVersion, project.dir);

        const releases = await this.listGitHubReleases(options.projectName);
        logger.log(`Check if a GitHub release already exists for ${releaseVersion}`);
        if (releases.find(r => r.tag_name === releaseVersion)) {
            utils.throwError(`Release ${releaseVersion} already exists`, options);
        }

        logger.log(`Check if a tag already exists for ${releaseVersion}`);
        if (utils.executeCommandWithOutput(`git tag --merged HEAD`, { cwd: project.dir }).toString().includes(`v${releaseVersion}`)) {
            utils.throwError(`Tag v${releaseVersion} already exists`, options);
        }

        logger.log(`Check if a pull request already exists for ${releaseVersion}`);
        let pullRequest = await this.getPullRequest(options.projectName, releaseVersion);
        if (pullRequest) {
            utils.throwError(`Pull request ${pullRequest.number} already exists`, options);
        }

        logger.log(`Create new release branch release/${releaseVersion}`);
        if (!utils.executeCommandSucceeds(`git checkout -b release/${releaseVersion}`, { cwd: project.dir })) {
            utils.throwError(`Cannot create release branch release/${releaseVersion}`, options);
        }

        project.version = await this.getVersion(project.dir);
        ProjectManager.installDependencies(project, options.installDependencies);

        logger.log(`Update the changelog`);
        try {
            new ChangelogGenerator().updateChangeLog({
                projectName: options.projectName,
                releaseVersion: releaseVersion
            });
        } catch (e) {
            throw new Error(`Failed to update changelog: ${e}`);
        }

        if (options.testRun) {
            logger.log(`TEST RUN: Skip commit and push`);
            logger.decreaseIndent();
            return;
        }

        logger.log(`Create commit with version increment and changelog updates`);
        await this.incrementedVersion(options.releaseType as ReleaseType, options.customVersion, project.dir);
        utils.executeCommandWithOutput(`git add package.json package-lock.json CHANGELOG.md`, { cwd: project.dir });
        utils.executeCommandWithOutput(`git commit -m 'Increment version to ${releaseVersion}'`, { cwd: project.dir });

        logger.log(`Push up the release branch`);
        utils.executeCommand(`git push origin release/${releaseVersion}`, { cwd: project.dir });

        logger.log(`Create GitHub release for ${releaseVersion}`);
        await this.octokit.rest.repos.createRelease({
            owner: this.ORG,
            repo: options.projectName,
            tag_name: `v${releaseVersion}`,
            name: releaseVersion,
            target_commitish: `release/${releaseVersion}`,
            body: `Release ${releaseVersion}`,
            draft: true
        });

        const prevReleaseVersion = ProjectManager.getPreviousVersion(releaseVersion, project.dir);
        //Creating the pull request will trigger another workflow, so it should be the last step of this flow
        logger.log(`Create pull request in ${options.projectName}: release/${releaseVersion} -> ${options.branch}`);
        await this.octokit.rest.pulls.create({
            owner: this.ORG,
            repo: options.projectName,
            title: releaseVersion,
            head: `release/${releaseVersion}`,
            base: options.branch,
            body: this.makePullRequestBody({ ...options, releaseVersion: releaseVersion, prevReleaseVersion: prevReleaseVersion, isDraft: true }),
            draft: false
        });

        pullRequest = await this.getPullRequest(options.projectName, releaseVersion);
        if (pullRequest) {
            logger.log(`Add the back link to the edit changelog link`);
            await this.octokit.rest.pulls.update({
                owner: this.ORG,
                repo: options.projectName,
                pull_number: pullRequest.number,
                body: this.makePullRequestBody({ ...options, releaseVersion: releaseVersion, prevReleaseVersion: prevReleaseVersion, isDraft: true, prNumber: pullRequest.number })
            });
        }

        logger.decreaseIndent();
    }

    /**
     * Replaces the release artifacts to the GitHub release
     * and add the changelog patch to the release notes
     */
    public async makeReleaseArtifacts(options: { branch: string; projectName: string; artifactPaths: string; force: boolean; testRun?: boolean }) {
        logger.log(`Upload release... artifactPaths: ${options.artifactPaths}`);
        logger.increaseIndent();

        const project = await ProjectManager.initialize({ ...options, installDependencies: false });

        logger.log(`Checkout the release branch ${options.branch}`);
        utils.executeCommand(`git checkout --quiet ${options.branch}`, { cwd: project.dir });

        const releaseVersion = await this.getVersion(project.dir);

        logger.log(`Get artifacts from the build`);
        const artifacts = fastGlob.sync(options.artifactPaths, { absolute: false });
        if (artifacts.length === 0) {
            throw new Error(`No artifacts found in ${options.artifactPaths}`);
        }

        logger.log(`Find the existing release ${releaseVersion}`);
        let releases = await this.listGitHubReleases(options.projectName);
        let draftRelease = releases.find(r => r.tag_name === `v${releaseVersion}`);
        if (!draftRelease) {
            throw new Error(`Release ${releaseVersion} does not exist`);
        }
        logger.log(`Found release ${releaseVersion}`);

        logger.log(`Get all existing release assets for ${options.projectName}`);
        let assets = await utils.octokitPageHelper((page: number) => {
            let result = this.octokit.repos.listReleaseAssets({
                owner: this.ORG,
                repo: options.projectName,
                release_id: draftRelease.id
            });
            return result;
        });

        // Throw an error if the release is already published and has assets, unless --force is specified
        if (draftRelease.draft === false && assets.length > 0 && !options.force) {
            throw new Error(`Release ${releaseVersion} already published with assets. Use --force to overwrite the assets.`);
        }
        logger.log(`Delete all release assets for ${options.projectName}`);
        for (const asset of assets) {
            if (options.testRun) {
                logger.log(`TEST RUN: Skipping delete of asset ${asset.name}`);
                continue;
            }
            const deleteResponse = await this.octokit.repos.deleteReleaseAsset({
                owner: this.ORG,
                repo: options.projectName,
                asset_id: asset.id
            });
            logger.inLog(`delete response status: ${deleteResponse.status}`);
            if (deleteResponse.status === 204) {
                logger.inLog(`Deleted asset ${asset.name}`);
            } else {
                logger.inLog(`Failed to delete asset ${asset.name}`);
            }
        }

        let duplicateArtifacts: string[] = [];

        logger.log(`Uploading artifacts`);
        for (const artifact of artifacts) {
            // eslint-disable-next-line @typescript-eslint/no-loop-func
            const uploadAsset = async (fileName: string, releaseId: number, options: { testRun?: boolean; projectName: string }) => {
                if (options.testRun) {
                    logger.log(`TEST RUN: Skipping upload of asset ${fileName}`);
                    return false;
                }
                let uploadResponse = await this.octokit.repos.uploadReleaseAsset({
                    owner: this.ORG,
                    repo: options.projectName,
                    release_id: releaseId,
                    name: fileName,
                    data: (fsExtra.readFileSync(artifact) as unknown as string),
                    headers: {
                        'content-type': 'application/octet-stream',
                        'content-length': fsExtra.statSync(artifact).size
                    }
                });
                if (uploadResponse.status === 201) {
                    logger.inLog(`Uploaded asset ${fileName}`);
                } else {
                    logger.inLog(`Failed to upload asset ${fileName}`);
                }
                return true;
            };
            const uploadTemporaryAsset = async (fileName: string, options: { testRun?: boolean; projectName: string }) => {
                let releases = await this.listGitHubReleases(options.projectName);
                let temporaryReleaseBucket = releases.find(r => r.tag_name === this.temporaryBucketTagName);
                if (temporaryReleaseBucket === undefined) {
                    logger.inLog(`Creating temporary release bucket`);
                    await this.octokit.rest.repos.createRelease({
                        owner: this.ORG,
                        repo: options.projectName,
                        tag_name: this.temporaryBucketTagName,
                        name: this.temporaryBucketTagName,
                        body: 'catchall release for temp packages',
                        draft: false
                    });
                    await utils.sleep(1000);
                    releases = await this.listGitHubReleases(options.projectName);
                    temporaryReleaseBucket = releases.find(r => r.tag_name === this.temporaryBucketTagName);
                } else if (temporaryReleaseBucket.draft === true) {
                    logger.inLog(`Temporary release bucket already exists as a draft, change to published`);
                    await this.octokit.rest.repos.updateRelease({
                        owner: this.ORG,
                        repo: options.projectName,
                        release_id: temporaryReleaseBucket.id,
                        draft: false
                    });
                }

                await uploadAsset(fileName, temporaryReleaseBucket.id, options);
            };
            const fileName = artifact.split('/').pop();
            logger.inLog(`Uploading ${fileName}`);
            await uploadAsset(fileName, draftRelease.id, options);

            const duplicateFileName = this.appendDateToArtifactName(fileName, releaseVersion, options.branch);
            logger.inLog(`Uploading duplicate ${fileName}`);
            await uploadTemporaryAsset(duplicateFileName, options);
            duplicateArtifacts.push(duplicateFileName);
        }

        logger.log(`Get the pull request for release ${releaseVersion}`);
        const pullRequest = await this.getPullRequest(options.projectName, releaseVersion);
        if (!pullRequest) {
            logger.log(`No pull request found for release ${releaseVersion}, skipping changelog patch notes update`);
            return;
        }

        logger.log(`Get the changelog file patch from the pull request`);
        const { data: files } = await this.octokit.rest.pulls.listFiles({
            owner: this.ORG,
            repo: options.projectName,
            pull_number: pullRequest.number
        });

        let lines = [];
        const changelogFile = files.find(f => f.filename === 'CHANGELOG.md');
        if (changelogFile) {
            const parsedPatch = diffParse(changelogFile.patch);

            parsedPatch?.at(0)?.chunks.forEach(chunk => {
                chunk.changes.forEach(change => {
                    // only add new lines to the patch notes
                    if (change.type === 'add') {
                        lines.push(change.content.slice(1));
                    }
                });
            });
        }

        // remove the release header from the patch notes
        const regex = new RegExp(`## \\[${releaseVersion}\\]\\(.*\\) - \\d{4}-\\d{2}-\\d{2}`);
        lines = lines.filter(l => !regex.test(l));

        let patchNotes = lines.join('\n');

        // remove the changelog header from the patch notes
        if (patchNotes.startsWith(ChangelogGenerator.HEADER)) {
            patchNotes = patchNotes.slice(ChangelogGenerator.HEADER.length);
        }

        logger.log(`Changelog patch: ${patchNotes}`);

        logger.log(`Add the changelog patch notes to the release notes`);
        await this.octokit.rest.repos.updateRelease({
            owner: this.ORG,
            repo: options.projectName,
            release_id: draftRelease.id,
            tag_name: draftRelease.tag_name,
            body: patchNotes
        });

        releases = await this.listGitHubReleases(options.projectName);
        draftRelease = releases.find(r => r.tag_name === `v${releaseVersion}`);

        const prevReleaseVersion = ProjectManager.getPreviousVersion(releaseVersion, project.dir);
        const artifactName = this.getArtifactName(artifacts, this.getAssetName(project.dir, options.artifactPaths)).split('/').pop();
        const duplicateArtifactName = this.getArtifactName(duplicateArtifacts, this.getAssetName(project.dir, options.artifactPaths)).split('/').pop();
        logger.log(`Artifact name: ${artifactName}`);
        let npm: PullRequestBodyInstallMessage | undefined;
        let vsix: PullRequestBodyInstallMessage | undefined;
        const tag = draftRelease.html_url.split('/').pop();
        const duplicateDownloadLink = `https://github.com/rokucommunity/${options.projectName}/releases/download/${this.temporaryBucketTagName}/${duplicateArtifactName}`;
        if (path.extname(artifactName) === '.tgz') {
            npm = {} as PullRequestBodyInstallMessage;
            npm.downloadLink = duplicateDownloadLink;
            npm.sha = utils.executeCommandWithOutput('git rev-parse --short HEAD', { cwd: project.dir }).toString().trim();
            npm.command = `\`\`\`bash\nnpm install ${duplicateDownloadLink}\n\`\`\``;
        } else if (path.extname(artifactName) === '.vsix') {
            vsix = {} as PullRequestBodyInstallMessage;
            vsix.downloadLink = duplicateDownloadLink;
            vsix.sha = utils.executeCommandWithOutput('git rev-parse --short HEAD', { cwd: project.dir }).toString().trim();
        }
        let body = this.makePullRequestBody({
            ...options,
            githubReleaseLink: draftRelease.html_url,
            releaseVersion: releaseVersion,
            prevReleaseVersion: prevReleaseVersion,
            isDraft: true,
            npm: npm,
            vsix: vsix,
            prNumber: pullRequest.number
        });
        logger.log(`Update the pull request with the release link and edit changelog link`);
        await this.octokit.rest.pulls.update({
            owner: this.ORG,
            repo: options.projectName,
            pull_number: pullRequest.number,
            body: body
        });

        logger.decreaseIndent();
    }

    /**
     * Marks the GitHub release as published
     * and releases the artifacts to the correct store
     */
    public async publishRelease(options: { projectName: string; ref: string; releaseType: string }) {
        logger.log(`publish release...branch: ${options.ref}, releaseType: ${options.releaseType}`);
        logger.increaseIndent();

        const project = await ProjectManager.initialize({ ...options, installDependencies: false });

        logger.log(`Checkout the release ${options.ref}`);
        utils.executeCommand(`git checkout --quiet ${options.ref}`, { cwd: project.dir });

        const releaseVersion = await this.getVersion(project.dir);

        logger.log(`Find the existing release ${releaseVersion}`);
        const releases = await this.listGitHubReleases(options.projectName);
        let draftRelease = releases.find(r => r.tag_name === `v${releaseVersion}`);
        let shouldMarkAsPublished = true;
        if (draftRelease?.draft) {
            logger.log(`Found release ${releaseVersion}`);
        } else if (draftRelease) {
            shouldMarkAsPublished = false;
            logger.log(`Release ${releaseVersion} is not a draft`);
        } else {
            throw new Error(`Release ${releaseVersion} does not exist`);
        }

        if (shouldMarkAsPublished) {
            logger.log(`Remove draft status from release ${releaseVersion}`);
            utils.executeCommand(`git tag v${releaseVersion} ${options.ref}`, { cwd: project.dir });
            utils.executeCommand(`git push origin v${releaseVersion}`, { cwd: project.dir });
            await this.octokit.rest.repos.updateRelease({
                owner: this.ORG,
                repo: options.projectName,
                release_id: draftRelease.id,
                draft: false
            });
        } else {
            logger.log(`Release ${releaseVersion} is already published`);
        }

        logger.log(`Get all existing release assets for ${options.projectName}`);
        let assets = await utils.octokitPageHelper((page: number) => {
            let result = this.octokit.repos.listReleaseAssets({
                owner: this.ORG,
                repo: options.projectName,
                release_id: draftRelease.id
            });
            return result;
        });

        for (const asset of assets) {
            logger.inLog(`Release asset: ${asset.name}`);
            const assetResponse = await this.octokit.repos.getReleaseAsset({
                owner: this.ORG,
                repo: options.projectName,
                asset_id: asset.id,
                headers: {
                    'Accept': 'application/octet-stream'
                }
            });
            const buffer = Buffer.from(new Uint8Array(assetResponse.data as any));
            fsExtra.writeFileSync(s`${project.dir}/${asset.name}`, buffer);
        }

        const artifactName = this.getArtifactName(assets.map(a => a.name), this.getAssetName(project.dir, path.extname(assets[0].name)));

        logger.log(`Publishing artifact ${artifactName} to ${options.releaseType}`);
        if (options.releaseType === 'npm') {
            const packageName = this.getPackageName(project.dir);
            const versions = utils.executeCommandWithOutput(`npm view ${packageName} versions --json`).toString();
            const json = JSON.parse(versions);
            const releaseTag = semver.prerelease(releaseVersion) ? `next` : `latest`;
            if (!json.includes(releaseVersion)) {
                logger.inLog(`OIDC Token URL: ${process.env.ACTIONS_ID_TOKEN_REQUEST_URL ? 'SET' : 'NOT SET'}`);
                logger.inLog(`OIDC Token: ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN ? 'SET' : 'NOT SET'}`);
                logger.inLog(`npm version: ${utils.executeCommandWithOutput('npm --version', { cwd: project.dir }).toString().trim()}`);

                // Fetch and decode OIDC token to see claims
                if (process.env.ACTIONS_ID_TOKEN_REQUEST_URL && process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN) {
                    try {
                        const tokenResponse = await fetch(process.env.ACTIONS_ID_TOKEN_REQUEST_URL + '&audience=npm', {
                            headers: {
                                'Authorization': `Bearer ${process.env.ACTIONS_ID_TOKEN_REQUEST_TOKEN}`
                            }
                        });
                        const tokenData = await tokenResponse.json();
                        if (tokenData.value) {
                            // Decode JWT (just the payload, no verification needed for debugging)
                            const payload = JSON.parse(Buffer.from(tokenData.value.split('.')[1], 'base64').toString());
                            logger.inLog(`OIDC Token Claims: ${JSON.stringify(payload, null, 2)}`);
                        }
                    } catch (e) {
                        logger.inLog(`Failed to fetch/decode OIDC token: ${e}`);
                    }
                }

                try {
                    // Disable provenance due to case mismatch in package.json repository URL
                    utils.executeCommand(`npm publish ${artifactName} --tag ${releaseTag} --provenance=false`, { cwd: project.dir });
                } catch (e) {
                    // Print npm debug log to understand what's happening
                    logger.inLog('npm debug log:');
                    logger.inLog(utils.executeCommandWithOutput('tail -50 /home/runner/.npm/_logs/*-debug-*.log 2>/dev/null || echo "No debug log found"'));
                    throw e;
                }
            } else {
                logger.inLog(`Version ${releaseVersion} already exists in npm`);
            }
        } else if (options.releaseType === 'vsce') {
            const vsceName = this.getVscePackageName(project.dir);
            { //Scope for vscode
                const versions = utils.executeCommandWithOutput(`npx @vscode/vsce show ${vsceName} --json`).toString();
                const json = JSON.parse(versions);
                if (!(json.versions.find((version: any) => version.version === releaseVersion))) {
                    logger.inLog(`Publishing ${artifactName} to VSCode Marketplace`);
                    utils.executeCommand(`npx @vscode/vsce publish --packagePath ${artifactName} -p ${process.env.VSCE_TOKEN}`, { cwd: project.dir });
                } else {
                    logger.inLog(`Version ${releaseVersion} already exists in VSCode Marketplace`);
                }
            }
            { //Scope for OpenVSX
                const response = utils.executeCommandWithOutput(`curl -s "https://open-vsx.org/api/-/query?extensionId=${vsceName}"`);
                const json = JSON.parse(response);
                const versions = json?.extensions[0]?.allVersions ?? {};
                if (!(releaseVersion in versions)) {
                    logger.inLog(`Publishing ${artifactName} to OpenVSX Registry`);
                    utils.executeCommand(`npx ovsx publish --packagePath "${artifactName}" --pat ${process.env.OPEN_VSX_TOKEN} --debug`, { cwd: project.dir });
                } else {
                    logger.inLog(`Version ${releaseVersion} already exists in OpenVSX Registry`);
                }
            }
        }

        logger.log(`Get the pull request for release ${releaseVersion}`);
        const pullRequest = await this.getPullRequest(options.projectName, releaseVersion, 'closed');

        const releaseLink = `https://github.com/rokucommunity/${options.projectName}/releases/tag/v${releaseVersion}`;
        const prevReleaseVersion = ProjectManager.getPreviousVersion(releaseVersion, project.dir);

        logger.log(`Update the pull request with the release link and edit changelog link`);
        await this.octokit.rest.pulls.update({
            owner: this.ORG,
            repo: options.projectName,
            pull_number: pullRequest.number,
            body: this.makePullRequestBody({
                ...options,
                githubReleaseLink: releaseLink,
                releaseVersion: releaseVersion,
                prevReleaseVersion: prevReleaseVersion,
                isDraft: false
            })
        });
        logger.decreaseIndent();
    }

    public async closeRelease(options: { projectName: string; ref: string }) {
        logger.log(`Close release...version`);
        logger.increaseIndent();

        const project = await ProjectManager.initialize({ ...options, installDependencies: false });

        logger.log(`Get the release version from the ref ${options.ref}`);
        const match = /^release\/(\d+\.\d+\.\d+)$/.exec(options.ref);
        const releaseVersion = match?.[1];

        logger.log(`Find the existing draft release`);
        const releases = await this.listGitHubReleases(options.projectName);
        let draftRelease = releases.find(r => r.tag_name === `v${releaseVersion}` && r.draft);
        if (draftRelease) {
            try {
                logger.log(`Deleting release ${releaseVersion}`);
                await this.octokit.rest.repos.deleteRelease({
                    owner: this.ORG,
                    repo: options.projectName,
                    release_id: draftRelease.id
                });
            } catch (error) {
                logger.log(`Failed to delete release ${releaseVersion}`);
            }
        }

        logger.log(`Rename pull request for abandoned release ${releaseVersion}`);
        const pullRequest = await this.getPullRequest(options.projectName, releaseVersion, 'closed');

        if (pullRequest) {
            try {
                await this.octokit.rest.pulls.update({
                    owner: this.ORG,
                    repo: options.projectName,
                    pull_number: pullRequest.number,
                    title: !pullRequest.title.endsWith(`(Abandoned)`) ? `${pullRequest.title} (Abandoned)` : pullRequest.title
                });
                logger.log(`Update pull request title ${pullRequest.number}`);
            } catch (error) {
                logger.log(`Failed to close pull request ${pullRequest.number}`);
            }
        }

        try {
            logger.log(`Delete branch release/${releaseVersion}`);
            await this.octokit.rest.git.deleteRef({
                owner: this.ORG,
                repo: options.projectName,
                ref: `heads/release/${releaseVersion}`
            });
        } catch (error) {
            logger.log(`Failed to delete branch release/${releaseVersion}`);
        }

        logger.decreaseIndent();
    }

    public async deleteRelease(options: { projectName: string; releaseVersion: string }) {
        logger.log(`Delete release...version: ${options.releaseVersion}`);
        logger.increaseIndent();

        logger.log(`Find the existing release ${options.releaseVersion}`);
        const releases = await this.listGitHubReleases(options.projectName);
        let draftRelease = releases.find(r => r.tag_name === `v${options.releaseVersion}` && r.draft);
        if (draftRelease) {
            try {
                logger.log(`Deleting release ${options.releaseVersion}`);
                await this.octokit.rest.repos.deleteRelease({
                    owner: this.ORG,
                    repo: options.projectName,
                    release_id: draftRelease.id
                });
            } catch (error) {
                logger.log(`Failed to delete release ${options.releaseVersion}`);
            }
        }

        logger.log(`Close pull request for release ${options.releaseVersion}`);
        const pullRequest = await this.getPullRequest(options.projectName, options.releaseVersion);

        if (pullRequest) {
            try {
                await this.octokit.rest.pulls.update({
                    owner: this.ORG,
                    repo: options.projectName,
                    pull_number: pullRequest.number,
                    state: 'closed'
                });
                logger.log(`Closed pull request ${pullRequest.number}`);
            } catch (error) {
                logger.log(`Failed to close pull request ${pullRequest.number}`);
            }
        }

        try {
            logger.log(`Delete branch release/${options.releaseVersion}`);
            await this.octokit.rest.git.deleteRef({
                owner: this.ORG,
                repo: options.projectName,
                ref: `heads/release/${options.releaseVersion}`
            });
        } catch (error) {
            logger.log(`Failed to delete branch release/${options.releaseVersion}`);
        }

        try {
            logger.log(`Delete tag v${options.releaseVersion}`);
            await this.octokit.rest.git.deleteRef({
                owner: this.ORG,
                repo: options.projectName,
                ref: `tags/v${options.releaseVersion}`
            });
        } catch (error) {
            logger.log(`Failed to delete tag v${options.releaseVersion}`);
        }

        logger.decreaseIndent();
    }

    private async getVersion(dir: string) {
        const packageJson = await fsExtra.readJson(path.join(dir, 'package.json'));
        logger.log(`Current version: ${packageJson.version}`);

        return packageJson.version;
    }

    private async getNewVersion(releaseType: ReleaseType, customVersion: string, dir: string) {
        if (customVersion) {
            return customVersion;
        }
        const packageJson = await fsExtra.readJson(path.join(dir, 'package.json'));
        logger.log(`Current version: ${packageJson.version}`);

        return semver.inc(packageJson.version, releaseType);
    }

    private async incrementedVersion(releaseType: ReleaseType, customVersion: string, dir: string) {
        const version = await this.getNewVersion(releaseType, customVersion, dir);
        logger.log(`Increment version on package.json to ${version}`);
        utils.executeCommand(`npm version ${version} --no-commit-hooks --no-git-tag-version --ignore-scripts`, { cwd: dir });

        return version;
    }

    private getPackageName(dir: string) {
        const packageJson = fsExtra.readJsonSync(path.join(dir, 'package.json'));
        return packageJson.name;
    }

    private getVscePackageName(dir: string) {
        const packageJson = fsExtra.readJsonSync(path.join(dir, 'package.json'));
        const publisher = packageJson.publisher ? `${packageJson.publisher}.` : '';
        return `${publisher}${packageJson.name}`;
    }


    private async listGitHubReleases(repoName: string) {
        logger.log(`Get all releases for ${repoName}`);
        const releases = await utils.octokitPageHelper((options: any, page: number) => {
            return this.octokit.rest.repos.listReleases({
                owner: this.ORG,
                repo: repoName,
                per_page: utils.OCTOKIT_PER_PAGE,
                page: page
            });
        });
        return releases;
    }

    private async getPullRequest(repoName: string, releaseVersion: string, state: 'open' | 'closed' = 'open') {
        const pullRequests = await this.octokit.rest.pulls.list({
            owner: this.ORG,
            repo: repoName,
            state: state,
            head: `release/${releaseVersion}`
        });
        return pullRequests.data.filter(pr => pr.head.ref === `release/${releaseVersion}`)[0];
    }

    private getAssetName(dir: string, extension: string) {
        extension = path.extname(extension);
        const packageJson = fsExtra.readJsonSync(path.join(dir, 'package.json'));
        const name = packageJson.name.replace(/@/g, '').replace(/\//g, '-');
        const version = packageJson.version;
        return `${name}-${version}${extension}`;
    }

    private makePullRequestBody(options: {
        githubReleaseLink?: string;
        projectName: string;
        releaseVersion?: string;
        prevReleaseVersion?: string;
        isDraft: boolean;
        npm?: PullRequestBodyInstallMessage;
        vsix?: PullRequestBodyInstallMessage;
        prNumber?: number;
    }) {
        if (options.isDraft) {
            let editChangeLogLink = `https://github.com/${this.ORG}/${options.projectName}/edit/release/${options.releaseVersion}/CHANGELOG.md`;
            if (options.prNumber) {
                editChangeLogLink += `?pr=/${this.ORG}/${options.projectName}/pull/${options.prNumber}`;
            }
            const whatsChangeLink = `https://github.com/${this.ORG}/${options.projectName}/compare/v${options.prevReleaseVersion}...release/${options.releaseVersion}`;
            return [
                `This PR creates the \`v${options.releaseVersion}\` release of \`${options.projectName}\`. Here are some useful links:\n`,
                `${options.githubReleaseLink ? `- [GitHub Draft Release](${options.githubReleaseLink})\n` : ''}`,
                `- [Edit changelog](${editChangeLogLink})\n`,
                `- [See what's changed](${whatsChangeLink})`,
                `${options.npm ? `\n\nClick [here](${options.npm.downloadLink}) to download a temporary npm package based on ${options.npm.sha}, or install with this command:\n ${options.npm.command}` : ''}`,
                `${options.vsix ? `\n\nClick [here](${options.vsix.downloadLink}) to download the .vsix based on ${options.vsix.sha}. Then follow [these installation instructions](https://rokucommunity.github.io/vscode-brightscript-language/prerelease-versions.html).` : ''}`
            ].join('');
        } else {
            const changeLogLink = `https://github.com/${this.ORG}/${options.projectName}/blob/v${options.releaseVersion}/CHANGELOG.md`;
            const whatsChangeLink = `https://github.com/${this.ORG}/${options.projectName}/compare/v${options.prevReleaseVersion}...v${options.releaseVersion}`;
            return [
                `This PR creates the \`v${options.releaseVersion}\` release of \`${options.projectName}\`. Here are some useful links:\n`,
                `- [GitHub Release](${options.githubReleaseLink})\n`,
                `- [Changelog](${changeLogLink})\n`,
                `- [See what's changed](${whatsChangeLink})`
            ].join('');
        }
    }

    private getArtifactName(artifacts: string[], assetNameHint: string) {
        function findArtifact() {
            if (artifacts.length === 1) {
                return artifacts[0];
            }
            //first filter out any artifacts that don't have the same extension
            const filteredArtifacts = artifacts.filter(a => a.endsWith(path.extname(assetNameHint)));
            if (filteredArtifacts.length === 1) {
                return filteredArtifacts[0];
            }
            //then find the artifact that matches the name hint the most
            //TODO update this to be fuzzy matching
            const matchingArtifacts = filteredArtifacts.filter(a => a.includes(path.basename(assetNameHint)));
            if (matchingArtifacts.length === 1) {
                return matchingArtifacts[0];
            }
            //if there are multiple, just return the first one
            if (matchingArtifacts.length > 0) {
                return matchingArtifacts[0];
            }
        }
        return findArtifact() ?? assetNameHint; //if nothing is found, return the name hint
    }

    private appendDateToArtifactName(artifactName: string, releaseVersion: string, branch: string) {
        const date = new Date().toISOString().replace(/[-:]/g, '').replace('T', '').split('.')[0];
        return artifactName.replace(/(\.[^.]+)$/, `-${branch.replace('/', '_')}.${date}$1`);
    }

}

interface PullRequestBodyInstallMessage {
    downloadLink: string;
    sha: string;
    command?: string;
}
