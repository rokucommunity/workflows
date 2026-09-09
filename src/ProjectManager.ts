import fetch from 'node-fetch';
import * as fsExtra from 'fs-extra';
import * as semver from 'semver';
import { logger, utils, standardizePath as s } from './utils';
import { Octokit } from '@octokit/rest';

/**
 * ProjectManager
 *
 * This class is a signleton class that manages the projects in the organization.
 * It will create a .tmp directory to store the cloned repositories.
 * It will store the map of projects, getters for project objects
 */
export class ProjectManager {
    static instance: ProjectManager;

    private tempDir = s`${__dirname}/../.tmp/.releases`;

    private projects: Project[] = [];

    public static async initialize(options: { projectName: string; installDependencies: boolean }) {
        const instance = ProjectManager.getInstance();
        if (instance.projects.length > 0) {
            logger.log('Projects have already been setup. Skipping');
            return ProjectManager.getProject(options.projectName);
        }

        logger.log('Creating tempDir', instance.tempDir);
        fsExtra.emptyDirSync(instance.tempDir);

        logger.log(`Getting all project ${options.projectName} dependencies`);
        let projectDependencies = await instance.getProjectDependencies(options);

        const project = ProjectManager.getProject(options.projectName);
        logger.log(`Setting up git config user name and email for project ${project.name}`);
        utils.executeCommand(`git config user.name "rokucommunity-bot"`, { cwd: project.dir });
        utils.executeCommand(`git config user.email "93661887+rokucommunity-bot@users.noreply.github.com"`, { cwd: project.dir });

        logger.log(`Setting up git remote origin for project ${project.name}`);
        const repoUrl = project.repositoryUrl.replace('https://', `https://x-access-token:${process.env.GH_TOKEN}@`);
        utils.executeCommand(`git remote set-url origin ${repoUrl}`, { cwd: project.dir });

        if (projectDependencies.length !== 0) {
            logger.log(`Cloning projects: ${projectDependencies.map(x => x.name).join(', ')}`);
            for (const project of projectDependencies) {
                instance.cloneProject(project);
            }
        }

        return project;
    }

    public static installDependencies(project: Project, installDependencies: boolean) {
        project.lastTag = ProjectManager.getPreviousVersion(
            fsExtra.readJsonSync(s`${project.dir}/package.json`).version as string,
            project.dir
        );
        let latestReleaseVersion: string;
        if (!project.lastTag) {
            logger.log('Not tags were found. Set the lastTag to the first commit hash');
            project.lastTag = utils.executeCommandWithOutput('git rev-list --max-parents=0 HEAD', { cwd: project.dir }).toString().trim();
            latestReleaseVersion = project.lastTag;
        } else {
            latestReleaseVersion = project.lastTag.replace(/^v/, '');
        }
        ProjectManager.innerInstallDependencies(project, latestReleaseVersion, installDependencies);
    }

    public static getProject(projectName: string) {
        return ProjectManager.getInstance().projects.find(x => x.name === projectName);
    }

    private static getInstance() {
        if (!ProjectManager.instance) {
            ProjectManager.instance = new ProjectManager();
        }
        return ProjectManager.instance;
    }

    private constructor() { }

    private async getProjectDependencies(options: { projectName: string }) {
        const octokit = new Octokit({
            auth: process.env.GH_TOKEN,
            request: { fetch }
        });
        logger.log(`Get all the projects from the rokucommunity org`);
        const projects = await utils.octokitPageHelper((options: any, page: number) => {
            return octokit.repos.listForOrg({
                org: 'rokucommunity',
                type: 'public',
                per_page: utils.OCTOKIT_PER_PAGE
            });
        });
        let projectNpmNames = [];
        logger.log(`Get all avaialble package.json for each project`);
        const promises = projects.map(async x => {
            const response = await octokit.repos.getContent({
                owner: 'rokucommunity',
                repo: x.name,
                path: 'package.json',
                request: { timeout: 10000 }
            });
            // Decode Base64 content
            const content = Buffer.from((response.data as any).content as string, 'base64').toString('utf-8');
            // Parse the cleaned string into a JSON object
            const jsonObject = JSON.parse(content);
            projectNpmNames.push({ repoName: x.name, packageName: jsonObject.name });
            this.projects.push(new Project(x.name, jsonObject.name, x.html_url));
        });
        await Promise.allSettled(promises);

        logger.log(`Get the project ${options.projectName} and clone it`);
        let project = ProjectManager.getProject(options.projectName);
        ProjectManager.getInstance().cloneProject(project);

        let projectsToClone: Project[] = [];
        logger.log(`Get the package.json for the project ${options.projectName}, and find the dependencies that need to be cloned`);
        let projectPackageJson = fsExtra.readJsonSync(s`${project.dir}/package.json`);
        if (projectPackageJson.dependencies) {
            Object.keys(projectPackageJson.dependencies).forEach(dependency => {
                let foundDependency = projectNpmNames.find(x => x.packageName === dependency);
                if (foundDependency) {
                    const foundProject = ProjectManager.getProject(foundDependency.repoName);
                    projectsToClone.push(foundProject);
                    project.dependencies.push(new ProjectDependency(dependency, foundDependency.repoName, '', '', foundProject.repositoryUrl));
                }
            });
        }
        if (projectPackageJson.devDependencies) {
            Object.keys(projectPackageJson.devDependencies).forEach(dependency => {
                let foundDependency = projectNpmNames.find(x => x.packageName === dependency);
                if (foundDependency) {
                    const foundProject = ProjectManager.getProject(foundDependency.repoName);
                    projectsToClone.push(foundProject);
                    project.devDependencies.push(new ProjectDependency(dependency, foundDependency.repoName, '', '', foundProject.repositoryUrl));
                }
            });
        }
        projectsToClone = [...new Set(projectsToClone)];
        return projectsToClone;
    }

    private cloneProject(project: Project) {
        const repoName = project.name.split('/').pop();

        let url = project.repositoryUrl;
        if (!url) {
            url = `https://github.com/rokucommunity/${repoName}`;
        }

        logger.log(`Cloning ${url}`);
        project.dir = s`${this.tempDir}/${repoName}`;

        utils.executeCommand(`git clone --no-single-branch "${url}" "${project.dir}"`);
    }

    private getDependencyVersionFromRelease(project: Project, releaseVersion: string, packageName: string, dependencyType: 'dependencies' | 'devDependencies') {
        const ref = utils.isVersion(releaseVersion) ? `v${releaseVersion}` : releaseVersion;
        const output = utils.tryExecuteCommandWithOutput(`git show ${ref}:package.json`, { cwd: project.dir }).toString();
        if (!output) {
            return '';
        }
        const packageJson = JSON.parse(output);
        const dependencyVersion = packageJson?.dependencies?.[packageName] || packageJson?.devDependencies?.[packageName];
        return dependencyVersion ? dependencyVersion.replace(/^(>=|<=|>|<|=|\^|~)/, '') : '';
    }

    public static innerInstallDependencies(project: Project, latestReleaseVersion: string, installDependencies: boolean) {
        logger.log('installing', project.dependencies.length, 'dependencies and', project.devDependencies.length, 'devDependencies');
        // preidBuildKey is used for the lockstep versioning
        let preidBuildKey = '';

        if (installDependencies && semver.prerelease(project.version)) {
            preidBuildKey = project.version.split('-')[1];
        }

        const install = (project: Project, dependencyType: 'dependencies' | 'devDependencies', flags?: string) => {
            for (const dependency of project[dependencyType]) {
                dependency.previousReleaseVersion = ProjectManager.getInstance().getDependencyVersionFromRelease(project, latestReleaseVersion, dependency.name, dependencyType);
                if (!dependency.previousReleaseVersion) {
                    const dependencyProject = this.getProject(dependency.repoName);
                    logger.log(`Dependency project dir: ${dependencyProject.dir}`);
                    dependency.previousReleaseVersion = utils.executeCommandWithOutput('git rev-list --max-parents=0 HEAD', { cwd: dependencyProject.dir });
                }
                if (installDependencies) {
                    //The floor for this dependency is the highest version we already know about: the pin sitting in the
                    //working tree's package.json, or the one from the previous release, whichever is greater. Using only the
                    //previous release's pin misses hand-bumps made since the last tag (i.e. the tree says `^4.0.0-alpha.5`
                    //while the last tag still says `^4.0.0-alpha.2`), which is how a `latest` of `3.18.4` once slipped through.
                    const currentPin = ProjectManager.getCurrentPinnedVersion(project, dependency.name, dependencyType);
                    const floor = ProjectManager.getHighestVersion(currentPin, dependency.previousReleaseVersion);

                    let installVersion = 'latest';
                    if (preidBuildKey && floor && semver.prerelease(floor)?.join('.') === preidBuildKey) {
                        //lockstep: this project and the dependency are on the exact same prerelease build key (i.e. both on
                        //`alpha.3`), so try to move them both to the same next number (i.e. both to `alpha.4`). Anything else
                        //(a shared `alpha` identifier at a different number, i.e. project `alpha.52` / dep `alpha.5`) is NOT a
                        //lockstep and falls through to the catch-up branch below.
                        logger.log(`Dependency ${dependency.name} has a matching prerelease version. Checking if there is a matching "lockstep" version.`);
                        const nextDepVersion = semver.inc(floor, 'prerelease');
                        if (utils.executeCommandSucceeds(`npm view ${dependency.name}@${nextDepVersion}`, { cwd: project.dir })) {
                            logger.log(`Matching version found. Installing ${dependency.name}@${nextDepVersion}`);
                            installVersion = nextDepVersion;
                        }
                    } else if (floor && semver.prerelease(floor)) {
                        //the dependency is on a prerelease line that this project is NOT locked to (i.e. a stable 0.x project
                        //depending on roku-deploy@4.0.0-alpha.3). `latest` points at the newest _stable_ version, which for a
                        //package mid-major-alpha is the OLD major (roku-deploy `latest` is 3.18.4 while the pin is 4.0.0-alpha.5),
                        //so never fall back to it here. Prefer the newest release on the same prerelease line, then allow
                        //graduating to a stable release that is genuinely newer than the floor (i.e. 4.0.0-alpha.6 -> 4.0.0).
                        const latestPrerelease = ProjectManager.getLatestPrereleaseVersion(project, dependency.name, floor);
                        const stableUpgrade = ProjectManager.getLatestStableUpgrade(project, dependency.name, floor);
                        const best = ProjectManager.getHighestVersion(latestPrerelease, stableUpgrade);
                        if (best) {
                            logger.log(`Dependency ${dependency.name} is on the ${floor} prerelease line. Best available upgrade is ${best}`);
                            installVersion = best;
                        } else {
                            logger.log(`No upgrade available for ${dependency.name} beyond ${floor}. Skipping installation.`);
                            continue;
                        }
                    }

                    const installVesrionString = utils.executeCommandWithOutput(`npm show ${dependency.name}@${installVersion} version`, { cwd: project.dir });
                    if (!installVesrionString || semver.valid(installVesrionString) === null) {
                        logger.log(`No valid version found for ${dependency.name}@${installVersion}. Using previous release version ${dependency.previousReleaseVersion}`);
                        continue;
                    }
                    if (utils.isVersion(floor) && semver.lte(installVesrionString, floor)) {
                        logger.log(`Moving ${dependency.name} from ${floor} to ${installVesrionString} is not an upgrade. Skipping installation.`);
                        continue;
                    }
                    utils.executeCommand(`npm install ${dependency.name}@${installVersion}`, { cwd: project.dir });

                    dependency.newVersion = ProjectManager.getInstalledVersion(project, dependency.name);

                    utils.executeCommandWithOutput(`git status --porcelain`, { cwd: project.dir })
                        .split(/\r?\n/)
                        .map(x => x.split(' ')[1]);

                    if (dependency.newVersion !== dependency.previousReleaseVersion) {
                        logger.log(`Updating ${dependencyType} version for ${dependency.name} from ${dependency.previousReleaseVersion} to ${dependency.newVersion}`);
                    }

                } else {
                    dependency.newVersion = ProjectManager.getInstalledVersion(project, dependency.name);
                }
            }
        };

        utils.executeCommand(`npm install`, { cwd: project.dir });

        install(project, 'dependencies');
        install(project, 'devDependencies', '--save-dev');
    }

    /**
     * Read the version of a dependency as it currently sits in the project's node_modules
     */
    public static getInstalledVersion(project: Project, packageName: string) {
        return fsExtra.readJsonSync(s`${project.dir}/node_modules/${packageName}/package.json`).version as string;
    }

    /**
     * Read the version range a dependency is currently pinned to in the project's working-tree package.json,
     * with any range prefix (`^`, `~`, `>=`, ...) stripped. This reflects hand-edits made since the last release tag.
     */
    public static getCurrentPinnedVersion(project: Project, packageName: string, dependencyType: 'dependencies' | 'devDependencies') {
        let packageJson: any;
        try {
            packageJson = fsExtra.readJsonSync(s`${project.dir}/package.json`);
        } catch {
            return undefined;
        }
        const range = packageJson?.[dependencyType]?.[packageName];
        if (!range) {
            return undefined;
        }
        const version = String(range).replace(/^(>=|<=|>|<|=|\^|~)/, '');
        return semver.valid(version) ? version : undefined;
    }

    /**
     * Return whichever of the given values is the highest valid semver version, ignoring anything that isn't
     * a version (i.e. the commit hash `previousReleaseVersion` falls back to when a dependency is brand new).
     */
    public static getHighestVersion(...versions: string[]) {
        const valid = versions.filter(x => x && semver.valid(x));
        return valid.length > 0 ? semver.rsort(valid)[0] : undefined;
    }

    /**
     * Find the newest published _stable_ release that is strictly newer than `currentVersion`. This lets a dependency
     * graduate off a prerelease line once the real release ships (i.e. `4.0.0-alpha.6` -> `4.0.0`), which `latest`
     * cannot be trusted to do while an older major still holds the `latest` tag.
     */
    public static getLatestStableUpgrade(project: Project, packageName: string, currentVersion: string) {
        const versions = ProjectManager.getPublishedVersions(project, packageName);
        const candidates = versions.filter(version => {
            return semver.valid(version) && !semver.prerelease(version) && semver.gt(version, currentVersion);
        });
        return candidates.length > 0 ? semver.rsort(candidates)[0] : undefined;
    }

    /**
     * Fetch the full list of versions published to npm for a package. Returns an empty array when npm has nothing to say.
     */
    public static getPublishedVersions(project: Project, packageName: string) {
        const output = utils.tryExecuteCommandWithOutput(`npm show ${packageName} versions --json`, { cwd: project.dir });
        if (!output) {
            return [];
        }
        try {
            const parsed = JSON.parse(output.toString());
            //npm returns a bare string when a package only has a single published version
            return Array.isArray(parsed) ? parsed as string[] : [parsed as string];
        } catch {
            logger.log(`Could not parse the version list for ${packageName}`);
            return [];
        }
    }

    /**
     * Find the newest published version on the same prerelease "line" as `currentVersion`.
     * The line is defined as the same major.minor.patch and the same prerelease identifier (i.e. `alpha` for `4.0.0-alpha.3`).
     * Returns undefined when nothing newer than `currentVersion` exists on that line.
     */
    public static getLatestPrereleaseVersion(project: Project, packageName: string, currentVersion: string) {
        const prerelease = semver.prerelease(currentVersion);
        if (!prerelease) {
            return undefined;
        }
        const preid = prerelease[0];

        const versions = ProjectManager.getPublishedVersions(project, packageName);

        const candidates = versions.filter(version => {
            if (!semver.valid(version) || semver.lte(version, currentVersion)) {
                return false;
            }
            //must be on the same major.minor.patch, with the same prerelease identifier
            return semver.diff(version, currentVersion) === 'prerelease' && semver.prerelease(version)?.[0] === preid;
        });

        return candidates.length > 0 ? semver.rsort(candidates)[0] : undefined;
    }

    public static getPreviousVersion(currentVersion: string, dir: string) {
        if (!semver.valid(currentVersion)) {
            return undefined;
        }

        let tags = utils.executeCommandWithOutput(`git tag --merged HEAD`, { cwd: dir }).toString().trim().split('\n');
        tags = tags.map(tag => tag.replace('v', '')).filter(tag => semver.valid(tag));
        tags = [currentVersion, ...tags];
        tags = semver.rsort(tags);
        let index = tags.indexOf(currentVersion);
        if (index === -1) {
            return undefined;
        }
        return tags[index + 1] ?? undefined;

    }
}


export class Project {
    constructor(name: string, npmName: string, repositoryUrl: string) {
        this.name = name;
        this.npmName = npmName;
        this.repositoryUrl = repositoryUrl ?? `https://github.com/rokucommunity/${name}`;
        this.version = '';
        this.dependencies = [];
        this.devDependencies = [];
        this.changes = [];
    }

    name: string;
    /**
     * The name of the package on npm. Defaults to `project.name`
     */
    npmName: string;
    repositoryUrl: string;
    /**
     * The directory where this project is cloned.
     */
    dir: string;
    version: string;
    dependencies: ProjectDependency[];
    devDependencies: ProjectDependency[];
    /**
     * A list of changes to be included in the changelog. If non-empty, this indicates the package needs a new release
     */
    changes: Commit[];
    lastTag: string;
}

export class ProjectDependency {
    name: string;
    repoName: string;
    previousReleaseVersion: string;
    newVersion: string;
    repositoryUrl: string;

    constructor(name: string, repoName: string, previousReleaseVersion: string, newVersion: string, repositoryUrl: string) {
        this.name = name;
        this.repoName = repoName;
        this.previousReleaseVersion = previousReleaseVersion;
        this.newVersion = newVersion;
        this.repositoryUrl = repositoryUrl;
    }

    public hasChanged() {
        return this.previousReleaseVersion !== this.newVersion && semver.valid(this.previousReleaseVersion) && semver.valid(this.newVersion);
    }
}


export interface Commit {
    hash: string;
    branchInfo: string;
    message: string;
    prNumber: string;
}
