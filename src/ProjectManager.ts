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
                    projectsToClone.push(ProjectManager.getProject(foundDependency.repoName));
                    project.dependencies.push({ name: dependency, repoName: foundDependency.repoName, previousReleaseVersion: '', newVersion: '' });
                }
            });
        }
        if (projectPackageJson.devDependencies) {
            Object.keys(projectPackageJson.devDependencies).forEach(dependency => {
                let foundDependency = projectNpmNames.find(x => x.packageName === dependency);
                if (foundDependency) {
                    projectsToClone.push(ProjectManager.getProject(foundDependency.repoName));
                    project.devDependencies.push({ name: dependency, repoName: foundDependency.repoName, previousReleaseVersion: '', newVersion: '' });
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
        return dependencyVersion ? dependencyVersion.replace(/^[\^~]/, '') : '';
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
                    let installVersion = 'latest';
                    if (preidBuildKey) {
                        if (semver.prerelease(dependency.previousReleaseVersion) && dependency.previousReleaseVersion.endsWith(preidBuildKey)) {
                            logger.log(`Dependency ${dependency.name} has a matching prerelease version. Checking if there is a matching "lockstep" version.`);
                            const nextDepVersion = semver.inc(dependency.previousReleaseVersion, 'prerelease');
                            if (utils.executeCommandSucceeds(`npm view ${dependency.name}@${nextDepVersion}`, { cwd: project.dir })) {
                                logger.log(`Matching version found. Installing ${dependency.name}@${nextDepVersion}`);
                                installVersion = nextDepVersion;
                            }
                        }
                    }

                    utils.executeCommand(`npm install ${dependency.name}@${installVersion}`, { cwd: project.dir });

                    dependency.newVersion = fsExtra.readJsonSync(s`${project.dir}/node_modules/${dependency.name}/package.json`).version;

                    utils.executeCommandWithOutput(`git status --porcelain`, { cwd: project.dir })
                        .split(/\r?\n/)
                        .map(x => x.split(' ')[1]);

                    if (dependency.newVersion !== dependency.previousReleaseVersion) {
                        logger.log(`Updating ${dependencyType} version for ${dependency.name} from ${dependency.previousReleaseVersion} to ${dependency.newVersion}`);
                    }

                } else {
                    dependency.newVersion = fsExtra.readJsonSync(s`${project.dir}/node_modules/${dependency.name}/package.json`).version;
                }
            }
        };

        utils.executeCommand(`npm install`, { cwd: project.dir });

        install(project, 'dependencies');
        install(project, 'devDependencies', '--save-dev');
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
    dependencies: Array<{
        name: string;
        repoName: string;
        previousReleaseVersion: string;
        newVersion: string;
    }>;
    devDependencies: Array<{
        name: string;
        repoName: string;
        previousReleaseVersion: string;
        newVersion: string;
    }>;
    /**
     * A list of changes to be included in the changelog. If non-empty, this indicates the package needs a new release
     */
    changes: Commit[];
    lastTag: string;
}

export interface Commit {
    hash: string;
    branchInfo: string;
    message: string;
    prNumber: string;
}
