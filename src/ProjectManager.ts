import fetch from 'node-fetch';
import * as fsExtra from 'fs-extra';
import * as semver from 'semver';
import { standardizePath as s } from 'brighterscript';
import { logger, utils } from './utils';
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

    public static async setupForProject(options: { projectName: string, installDependencies: boolean }) {
        const instance = ProjectManager.getInstance();
        if (instance.projects.length > 0) {
            logger.log('Projects have already been setup. Skipping');
            return ProjectManager.getProject(options.projectName);
        }

        logger.log('Creating tempDir', instance.tempDir);
        fsExtra.emptyDirSync(instance.tempDir);


        logger.log(`Getting all project ${options.projectName} dependencies`);
        let projects = await instance.getProjectDependencies(options.projectName);

        const project = ProjectManager.getProject(options.projectName);
        logger.log(`Setting up git config user name and email for project ${project.name}`);
        utils.executeCommand(`git config user.name "rokucommunity-bot"`, { cwd: project.dir });
        utils.executeCommand(`git config user.email "93661887+rokucommunity-bot@users.noreply.github.com"`, { cwd: project.dir });

        logger.log(`Cloning projects: ${projects.map(x => x.name).join(', ')}`);
        for (const project of projects) {
            instance.cloneProject(project);
        }

        project.lastTag = instance.getLastTag(project.dir);
        let latestReleaseVersion;
        if (!project.lastTag) {
            logger.log('Not tags were found. Set the lastTag to the first commit hash');
            project.lastTag = utils.executeCommandWithOutput('git rev-list --max-parents=0 HEAD', { cwd: project.dir }).toString().trim();
            latestReleaseVersion = project.lastTag;
        } else {
            latestReleaseVersion = project.lastTag.replace(/^v/, '');
        }
        ProjectManager.installDependencies(project, latestReleaseVersion, options.installDependencies);
        return project;
    }

    public static getProject(projectName: string) {
        return ProjectManager.getInstance().projects.find(x => x.name === projectName)!;
    }

    private static getInstance() {
        if (!ProjectManager.instance) {
            ProjectManager.instance = new ProjectManager();
        }
        return ProjectManager.instance;
    }

    private constructor() { }

    private async getProjectDependencies(projectName: string) {
        const octokit = new Octokit({
            auth: process.env.GH_TOKEN,
            request: { fetch }
        });
        logger.log(`Get all the projects from the rokucommunity org`);
        const projects = await utils.octokitPageHelper((options: any, page: number) => {
            return octokit.repos.listForOrg({
                org: 'rokucommunity',
                type: 'public',
                per_page: utils.OCTOKIT_PER_PAGE,
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
            const content = Buffer.from((response.data as any).content, "base64").toString("utf-8");
            // Parse the cleaned string into a JSON object
            const jsonObject = JSON.parse(content);
            projectNpmNames.push({ repoName: x.name, packageName: jsonObject.name });
            this.projects.push(new Project(x.name, jsonObject.name, x.html_url));
        });
        await Promise.allSettled(promises);

        logger.log(`Get the project ${projectName} and clone it`);
        let project = ProjectManager.getProject(projectName);
        ProjectManager.getInstance().cloneProject(project);

        logger.log(`Get the package.json for the project ${projectName}, and find the dependencies that need to be cloned`);
        let projectPackageJson = fsExtra.readJsonSync(s`${project.dir}/package.json`).version;
        let projectsToClone: Project[] = [];
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
        const version = packageJson?.[dependencyType][packageName];
        return /\d+\.\d+\.\d+/.exec(version)?.[0] as string;
    }

    public static installDependencies(project: Project, latestReleaseVersion: string, installDependencies: boolean) {
        logger.log('installing', project.dependencies.length, 'dependencies and', project.devDependencies.length, 'devDependencies');

        const install = (project: Project, dependencyType: 'dependencies' | 'devDependencies', flags?: string) => {
            for (const dependency of project[dependencyType]) {
                dependency.previousReleaseVersion = ProjectManager.getInstance().getDependencyVersionFromRelease(project, latestReleaseVersion, dependency.name, dependencyType);
                if (!dependency.previousReleaseVersion) {
                    const dependencyProject = this.getProject(dependency.repoName);
                    logger.log(`Dependency project dir: ${dependencyProject.dir}`);
                    dependency.previousReleaseVersion = utils.executeCommandWithOutput('git rev-list --max-parents=0 HEAD', { cwd: dependencyProject.dir });
                }

                if (installDependencies) {
                    utils.executeCommand(`npm install ${dependency.name}@latest`, { cwd: project.dir });

                    dependency.newVersion = fsExtra.readJsonSync(s`${project.dir}/node_modules/${dependency.name}/package.json`).version;

                    const fileChanges = utils.executeCommandWithOutput(`git status --porcelain`, { cwd: project.dir })
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

    /**
     * Find the highest non-prerelease tag for this repository
     */
    private getLastTag(cwd: string) {
        const allTags = semver.sort(
            utils.executeCommandWithOutput(`git tag --sort version:refname`, { cwd: cwd })
                .toString()
                .split(/\r?\n/)
                .map(x => x.trim())
                //only keep valid version tags
                .filter(x => semver.valid(x))
                //exclude prerelease versions
                .filter(x => !semver.prerelease(x))
        ).reverse();

        return allTags[0];
    }
}


export class Project {
    constructor(name: string, npmName?: string, repositoryUrl?: string) {
        this.name = name;
        this.npmName = npmName;
        this.repositoryUrl = repositoryUrl ?? `https://github.com/rokucommunity/${name}`;
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
