import * as fsExtra from 'fs-extra';
import * as path from 'path';
import * as semver from 'semver';
import * as dotenv from 'dotenv';
import * as fastGlob from 'fast-glob';
import fetch from 'node-fetch';
import { standardizePath as s } from 'brighterscript';
import { option } from 'yargs';
import { logger, utils } from './utils';
import { Octokit } from '@octokit/rest';
import { ChangelogGenerator } from './ChangeLogGenerator';
import { Project, ProjectManager } from './ProjectManager';
import * as diffParse from 'parse-diff';

type ReleaseType = 'major' | 'minor' | 'patch';

/**
 * This class is responsible for managing the local git repository, GitHub PRs, and GitHub Releases
**/

export class ReleaseCreator {
    private octokit: Octokit;
    private ORG = 'rokucommunity';

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
    public async initializeRelease(options: { projectName: string, releaseType: ReleaseType | string, branch: string, installDependencies: boolean, testRun?: boolean }) {
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
        if (!utils.executeCommandSucceeds(`git fetch origin`, { cwd: project.dir })) {
            utils.throwError(`Failed to fetch origin`, options);
        }

        logger.log(`Get the incremented release version`);
        const releaseVersion = await this.getNewVersion(options.releaseType as ReleaseType, project.dir);

        const releases = await this.listGitHubReleases(options.projectName);
        logger.log(`Check if a GitHub release already exists for ${releaseVersion}`);
        if (releases.find(r => r.tag_name === releaseVersion)) {
            utils.throwError(`Release ${releaseVersion} already exists`, options);
        }

        logger.log(`Create new release branch release/${releaseVersion}`);
        if (!utils.executeCommandSucceeds(`git checkout -b release/${releaseVersion}`, { cwd: project.dir })) {
            utils.throwError(`Cannot create release branch release/${releaseVersion}`, options);
        }

        await ProjectManager.installDependencies(project, options.installDependencies);

        logger.log(`Update the changelog`);
        await new ChangelogGenerator().updateChangeLog({
            projectName: options.projectName,
            releaseVersion: releaseVersion
        }).catch(e => {
            throw new Error(`Failed to update changelog: ${e}`);
        });

        if (options.testRun) {
            logger.log(`TEST RUN: Skip commit and push`);
            logger.decreaseIndent();
            return;
        }

        logger.log(`Create commit with version increment and changelog updates`);
        await this.incrementedVersion(options.releaseType as ReleaseType, project.dir);
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
            body: `Release ${releaseVersion}`,
            draft: true
        });

        //Creating the pull request will trigger another workflow, so it should be the last step of this flow
        logger.log(`Create pull request in ${options.projectName}: release/${releaseVersion} -> ${options.branch}`);
        const linkDate = new Date().toISOString().split('T')[0];
        const versionStrip = releaseVersion.replace('.', '');
        const changelogLink = `https://github.com/${this.ORG}/${options.projectName}/blob/release/${releaseVersion}/CHANGELOG.md#${versionStrip}---${linkDate}`;
        const createResponse = await this.octokit.rest.pulls.create({
            owner: this.ORG,
            repo: options.projectName,
            title: releaseVersion,
            head: `release/${releaseVersion}`,
            body: `[CHANGELOG.md](${changelogLink})`,
            base: options.branch,
            draft: false
        });

        logger.decreaseIndent();
    }

    /**
     * Replaces the release artifacts to the GitHub release
     * and add the changelog patch to the release notes
     */
    public async makeReleaseArtifacts(options: { branch: string; projectName: string; artifactPaths: string }) {
        logger.log(`Upload release... artifactPaths: ${options.artifactPaths}`);
        logger.increaseIndent();

        //TODO this needs another look. We get the artifacts from the previous step and upload them. 
        //The only thing that uses the diretory is getting the version which reads the package.json
        //I can't assume that I'm running in the repo I care about though so this might be necessary
        const project = await ProjectManager.initialize({ ...options, installDependencies: false });

        logger.log(`Checkout the release branch ${options.branch}`);
        utils.executeCommand(`git checkout --quiet ${options.branch}`, { cwd: project.dir });

        const releaseVersion = await this.getVersion(project.dir);

        logger.log(`Find the existing release ${releaseVersion}`);
        const releases = await this.listGitHubReleases(options.projectName);
        let draftRelease = releases.find(r => r.tag_name === `v${releaseVersion}`);
        if (!draftRelease) {
            throw new Error(`Release ${releaseVersion} does not exist`);
        } else if (draftRelease.draft === false) {
            throw new Error(`Release ${releaseVersion} already published`);
        }
        logger.log(`Found release ${releaseVersion}`);

        logger.log(`Get all existing release assets for ${options.projectName}`);
        let assets = await utils.octokitPageHelper((page: number) => {
            let result = this.octokit.repos.listReleaseAssets({
                owner: this.ORG,
                repo: options.projectName,
                release_id: draftRelease.id,
            });
            return result;
        });
        logger.log(`Delete all release assets for ${options.projectName}`);
        for (const asset of assets) {
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

        logger.log(`Get artifacts from the build`)
        const artifacts = fastGlob.sync(options.artifactPaths, { absolute: false })

        logger.log(`Uploading artifacts`);
        for (const artifact of artifacts) {
            const fileName = artifact.split('/').pop();
            logger.inLog(`Uploading ${fileName}`);
            const uploadResponse = await this.octokit.repos.uploadReleaseAsset({
                owner: this.ORG,
                repo: options.projectName,
                release_id: draftRelease.id,
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
        }

        logger.log(`Get the pull request for release ${releaseVersion}`);
        const pullRequest = await this.octokit.rest.pulls.list({
            owner: this.ORG,
            repo: options.projectName,
            state: 'open',
            head: `release/${releaseVersion}`
        });

        logger.log(`Get the changelog file patch from the pull request`);
        const { data: files } = await this.octokit.rest.pulls.listFiles({
            owner: this.ORG,
            repo: options.projectName,
            pull_number: pullRequest.data[0].number
        });

        let lines = [];
        const changelogFile = files.find(f => f.filename === 'CHANGELOG.md');
        if (changelogFile) {
            const parsedPatch = diffParse.default(changelogFile.patch);

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

        logger.decreaseIndent();
    }

    /**
     * Marks the GitHub release as published 
     * and releases the artifacts to the correct store
     */
    public async publishRelease(options: { projectName: string, ref: string, releaseType: string }) {
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
            await this.octokit.rest.repos.updateRelease({
                owner: this.ORG,
                repo: options.projectName,
                release_id: draftRelease.id,
                draft: false
            });

            utils.executeCommandWithOutput(`git tag v${releaseVersion} ${options.ref} -m '${releaseVersion}'`, { cwd: project.dir });
            utils.executeCommand(`git push origin v${releaseVersion}`, { cwd: project.dir });
        } else {
            logger.log(`Release ${releaseVersion} is already published`);
        }

        logger.log(`Get all existing release assets for ${options.projectName}`);
        let assets = await utils.octokitPageHelper((page: number) => {
            let result = this.octokit.repos.listReleaseAssets({
                owner: this.ORG,
                repo: options.projectName,
                release_id: draftRelease.id,
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

            await fsExtra.writeFileSync(s`${project.dir}/${asset.name}`, buffer);
        }


        logger.log(`Publishing artifacts`);
        if (options.releaseType === 'npm') {
            const packageName = this.getPackageName(project.dir);
            const versions = utils.executeCommandWithOutput(`npm view ${packageName} versions --json`).toString();
            const json = JSON.parse(versions);
            if (!json.includes(releaseVersion)) {
                logger.inLog(`Publishing ${assets[0].name} to npm`);
                //utils.executeCommand(`npm publish ${assets[0].name}`, { cwd: project.dir });
            } else {
                logger.inLog(`Version ${releaseVersion} already exists in npm`);
            }
        } else if (options.releaseType === 'vsce') {
            const vsceName = this.getVscePackageName(project.dir);
            { //Scope for vscode
                const versions = utils.executeCommandWithOutput(`npx @vscode/vsce show ${vsceName} --json`).toString();
                const json = JSON.parse(versions);
                if (!(json.versions.find((version: any) => version.version === releaseVersion))) {
                    logger.inLog(`Publishing ${assets[0].name} to vscode`);
                    // utils.executeCommand(`npx vsce publish --packagePath ${assets[0].name} -p ${process.env.VSCE_TOKEN}`, { cwd: project.dir });
                } else {
                    logger.inLog(`Version ${releaseVersion} already exists in vscode`);
                }
            }
            { //Scope for open-vsx
                const response = utils.executeCommandWithOutput(`curl -s "https://open-vsx.org/api/-/query?extensionId=${vsceName}"`);
                const json = JSON.parse(response);
                const versions = json?.extensions[0]?.allVersions ?? {};
                if (!(releaseVersion in versions)) {
                    logger.inLog(`Publishing ${assets[0].name} to open - vsx`);
                    // utils.executeCommand(`npx ovsx publish --packagePath ${assets[0].name} -p ${process.env.VSCE_TOKEN} --debug`, { cwd: project.dir });
                } else {
                    logger.inLog(`Version ${releaseVersion} already exists in open-vsx`);
                }
            }

        }

        logger.decreaseIndent();
    }

    public async deleteRelease(options: { projectName: string, releaseVersion: string }) {
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
        const pullRequest = await this.octokit.rest.pulls.list({
            owner: this.ORG,
            repo: options.projectName,
            state: 'open',
            head: `release/${options.releaseVersion}`
        });
        if (pullRequest.data.length > 0) {
            for (const pr of pullRequest.data) {
                try {
                    await this.octokit.rest.pulls.update({
                        owner: this.ORG,
                        repo: options.projectName,
                        pull_number: pr.number,
                        state: 'closed'
                    });
                    logger.log(`Closed pull request ${pr.number}`);
                } catch (error) {
                    logger.log(`Failed to close pull request ${pr.number}`);
                }
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

    private async getNewVersion(releaseType: ReleaseType, dir: string) {
        const packageJson = await fsExtra.readJson(path.join(dir, 'package.json'));
        logger.log(`Current version: ${packageJson.version}`);

        return semver.inc(packageJson.version, releaseType);
    }

    private async incrementedVersion(releaseType: ReleaseType, dir: string) {
        const version = await this.getNewVersion(releaseType, dir);
        logger.log(`Increment version on package.json to ${version}`);
        utils.executeCommand(`npm version ${version} --no-commit-hooks --no-git-tag-version --ignore-scripts`, { cwd: dir });

        return version;
    }

    private async getPackageName(dir: string) {
        const packageJson = await fsExtra.readJson(path.join(dir, 'package.json'));
        return packageJson.name;
    }

    private async getVscePackageName(dir: string) {
        const packageJson = await fsExtra.readJson(path.join(dir, 'package.json'));
        //TODO make sure publisher exists
        return `${packageJson.publisher}.${packageJson.name}`
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

    private getRepositoryName() {
        // This is neccessary because this code is intended to run in different repositories
        const repoPath = utils.executeCommandWithOutput(`git rev-parse --show-toplevel`).trim();
        const repoName = require("path").basename(repoPath);
        logger.log(`Repository name: ${repoName}`);
        return repoName;
    }

}
