/**
 * This script generates the changelog for a project based on changes to it
 * and its dependencies. It should not make any changes to the repository itself.
 * Only generate the changelog for an other class to commit.
 */
import * as fsExtra from 'fs-extra';
import * as semver from 'semver';
import { logger, utils, standardizePath as s } from './utils';
import type { Commit, Project } from './ProjectManager';
import { ProjectManager } from './ProjectManager';

export class ChangelogGenerator {

    static MARKER = 'this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).';
    static HEADER = `# Changelog
All notable changes to this project will be documented in this file.

The format is based on [Keep a Changelog](https://keepachangelog.com/en/1.0.0/),
and this project adheres to [Semantic Versioning](https://semver.org/spec/v2.0.0.html).`;

    public updateChangeLog(options: { projectName: string; releaseVersion: string }) {
        logger.log(`Updating changelog for project ${options.projectName}`);
        logger.increaseIndent();

        //The projects are already setup in the releaseCreator class
        const project = ProjectManager.getProject(options.projectName);

        logger.log(`Last release was ${project.lastTag}`);

        this.computeChanges(project);

        if (project.changes.length === 0) {
            logger.log('Nothing has changed since last release');
            logger.decreaseIndent();
            return;
        }

        const lines = this.getChangeLogs(project, options.releaseVersion);
        logger.log(lines);

        //assume the project running this command is the project being updated
        const changelogPath = s`${project.dir}/CHANGELOG.md`;

        if (!fsExtra.existsSync(changelogPath)) {
            logger.log('No changelog.md file found. Creating one');
            fsExtra.outputFileSync(changelogPath, ChangelogGenerator.HEADER);
        }

        let changelog = fsExtra.readFileSync(changelogPath).toString();
        if (changelog === '') {
            logger.log('No content in changelog.md file. Adding header');
            fsExtra.outputFileSync(changelogPath, ChangelogGenerator.HEADER);
            changelog = fsExtra.readFileSync(changelogPath).toString();
        }

        const [eolChar] = /\r?\n/.exec(changelog) ?? ['\r\n'];
        if (!changelog.includes(ChangelogGenerator.MARKER)) {
            logger.log('Could not find marker in changelog. Adding header to top');
            changelog = ChangelogGenerator.HEADER + eolChar + changelog;
        }
        changelog = changelog.replace(
            ChangelogGenerator.MARKER,
            ChangelogGenerator.MARKER + lines.join(eolChar)
        );
        fsExtra.outputFileSync(changelogPath, changelog);
        logger.decreaseIndent();
    }

    /**
     * Find the year-month-day of the specified release from git logs
     */
    private getVersionDate(cwd: string, version: string) {
        const logOutput = utils.executeCommandWithOutput('git log --tags --simplify-by-decoration --pretty="format:%ci %d"', { cwd: cwd }).toString();
        const [, date] = new RegExp(String.raw`(\d+-\d+-\d+).*?tag:[ \t]*v${version.replace('.', '\\.')}`, 'gmi').exec(logOutput) ?? [];
        return date;
    }

    private getChangeLogs(project: Project, releaseVersion: string) {
        const [month, day, year] = new Date().toLocaleDateString().split('/');

        function getReflink(project: { name: string; repositoryUrl: string }, commit: Commit, includeProjectName = false) {
            let preHashName = includeProjectName ? project.name : undefined;
            if (commit.prNumber) {
                return `[${preHashName ?? ''}#${commit.prNumber}](${project.repositoryUrl}/pull/${commit.prNumber})`;
            } else {
                preHashName = preHashName ? preHashName + '#' : '';
                return `[${preHashName}${commit.hash}](${project.repositoryUrl}/commit/${commit.hash})`;
            }
        }

        const lines = [
            '', '', '', '',
            `## [${releaseVersion}](${project.repositoryUrl}/compare/${project.lastTag}...v${releaseVersion}) - ${year}-${month.padStart(2, '0')}-${day.padStart(2, '0')}`
        ];
        //build a map of commit messages to sections
        const sectionMap: Record<ChangelogSection, string[]> = {
            Added: [],
            Changed: [],
            Deprecated: [],
            Fixed: [],
            Removed: [],
            Chore: []
        };

        function getReflinks(project: { name: string; repositoryUrl: string }, commits: Commit[], includeProjectName = false) {
            return commits.map(commit => getReflink(project, commit, includeProjectName)).join(', ');
        }

        const projectContext: CommitContext = { dir: project.dir, ref: 'HEAD' };
        for (const group of this.groupCommitsByMessage(this.getCommitLogs(project.name, project.lastTag, 'HEAD'), projectContext)) {
            const section = this.getChangelogHeaderForMessage(group.message);
            if (section) {
                if (section === 'Chore') {
                    continue;
                }
                sectionMap[section].push(` - ${group.message} (${getReflinks(project, group.commits)})`);
            } else {
                sectionMap.Changed.push(` - ${group.message} (${getReflinks(project, group.commits)})`);
            }
        }

        for (const dependency of [...project.dependencies, ...project.devDependencies]) {
            if (!utils.isVersion(dependency.previousReleaseVersion)) {
                sectionMap.Added.push(` - added [${dependency.name}@${dependency.newVersion}](${ProjectManager.getProject(dependency.repoName).repositoryUrl})`);
            } else if (dependency.hasChanged()) {
                const dependencyProject = ProjectManager.getProject(dependency.repoName);
                if (semver.gt(dependency.newVersion, dependency.previousReleaseVersion)) {
                    sectionMap.Changed.push(
                        [
                            ` - upgrade to [${dependency.name}@${dependency.newVersion}]`,
                            `(${dependencyProject.repositoryUrl}/blob/master/CHANGELOG.md#`,
                            `${dependency.newVersion.replace(/\./g, '')}---${this.getVersionDate(dependencyProject.dir, dependency.newVersion)}). `,
                            `Notable changes since ${dependency.previousReleaseVersion}:`
                        ].join('')
                    );
                    const dependencyCommits = this.getCommitLogs(dependency.repoName, dependency.previousReleaseVersion, dependency.newVersion);
                    const dependencyContext: CommitContext = {
                        dir: dependencyProject.dir,
                        ref: utils.isVersion(dependency.newVersion) ? `v${dependency.newVersion}` : dependency.newVersion
                    };
                    for (const group of this.groupCommitsByMessage(dependencyCommits, dependencyContext)) {
                        sectionMap.Changed.push(`     - ${group.message} (${getReflinks(dependency, group.commits)})`);
                    }
                } else {
                    sectionMap.Changed.push(
                        [
                            ` - downgrade from ${dependency.previousReleaseVersion} to [${dependency.name}@${dependency.newVersion}]`,
                            `(${dependencyProject.repositoryUrl}/blob/master/CHANGELOG.md#`,
                            `${dependency.newVersion.replace(/\./g, '')}---${this.getVersionDate(dependencyProject.dir, dependency.newVersion)}).`
                        ].join('')
                    );

                }
            }
        }

        for (const [section, messages] of Object.entries(sectionMap)) {
            if (messages.length > 0) {
                lines.push(`### ${section}`);
                for (const message of messages) {
                    lines.push(message);
                }
            }
        }

        return lines;
    }

    static SECURITY_ENHANCEMENTS_MESSAGE = 'Security enhancements';

    /**
     * Cache of `<dir>|<ref>|<path>` -> the set of dependency names declared in that package.json, so we only
     * shell out to git once per manifest.
     */
    private manifestDependencyCache = new Map<string, Set<string>>();

    /**
     * Read the dependency names declared in `<path>/package.json` at the given git ref of the given repo.
     * Returns an empty set when the manifest doesn't exist or can't be parsed.
     */
    private getDeclaredDependencies(dir: string, ref: string, path: string) {
        const cacheKey = `${dir}|${ref}|${path}`;
        let dependencyNames = this.manifestDependencyCache.get(cacheKey);
        if (dependencyNames) {
            return dependencyNames;
        }
        dependencyNames = new Set<string>();
        //`path` is repo-relative and may be `/`, `/benchmarks`, `/packages/foo`, etc.
        const manifestPath = `${path.replace(/^\/+|\/+$/g, '')}/package.json`.replace(/^\//, '');
        const output = utils.tryExecuteCommandWithOutput(`git show ${ref}:${manifestPath}`, { cwd: dir }).toString();
        if (output) {
            try {
                const packageJson = JSON.parse(output);
                for (const dependencyType of ['dependencies', 'devDependencies', 'optionalDependencies', 'peerDependencies']) {
                    for (const name of Object.keys(packageJson?.[dependencyType] ?? {})) {
                        dependencyNames.add(name);
                    }
                }
            } catch {
                //a manifest we can't parse tells us nothing; treat it as declaring nothing
            }
        }
        this.manifestDependencyCache.set(cacheKey, dependencyNames);
        return dependencyNames;
    }

    /**
     * A multi-path dependabot bump (i.e. `Bump brace-expansion in /benchmarks and /docs`) is only treated as a
     * dependency bump when the named package is actually declared in one of those manifests. That keeps us from
     * folding an unrelated message that happens to share the shape (i.e. `Bump local_var in /SomeRoute and /Other`).
     */
    private isDependencyOfAnyPath(packageName: string, paths: string[], context?: CommitContext) {
        if (!context?.dir) {
            return false;
        }
        return paths.some(path => this.getDeclaredDependencies(context.dir, context.ref, path).has(packageName));
    }

    /**
     * Dependabot-style version bumps (i.e. `Bump qs from 6.14.2 to 6.15.3` or `Bump brace-expansion in /benchmarks`)
     * are all security-related, so treat them as the same change as `Security enhancements` so they can be
     * combined into a single entry. A leading `chore:` is ignored so `chore: Security enhancements` combines
     * with `Security enhancements`.
     */
    private normalizeCommitMessage(message: string, context?: CommitContext) {
        //ignore a leading conventional-commit `chore:`/`chore(deps):` prefix when comparing
        const bareMessage = message.replace(/^chore(\([^)]*\))?:\s*/i, '');
        if (bareMessage.toLowerCase() === ChangelogGenerator.SECURITY_ENHANCEMENTS_MESSAGE.toLowerCase()) {
            return ChangelogGenerator.SECURITY_ENHANCEMENTS_MESSAGE;
        }
        //`Bump <pkg> from <x> to <y>` and single-path `Bump <pkg> in <path>` are unambiguously dependabot
        if (/^bump\s+\S+\s+(?:from\s+\S+\s+to\s+\S+|in\s+\S+)$/i.test(bareMessage)) {
            return ChangelogGenerator.SECURITY_ENHANCEMENTS_MESSAGE;
        }
        //`Bump <pkg> in <path>[,] and <path>...` shares its shape with ordinary prose, so verify the package
        //is really declared in one of those manifests before folding it in
        const [, packageName, pathList] = /^bump\s+(\S+)\s+in\s+(\S.*)$/i.exec(bareMessage) ?? [];
        if (packageName && pathList) {
            const paths = pathList.split(/\s*(?:,|\band\b)\s*/i).filter(x => x.startsWith('/'));
            if (paths.length > 0 && this.isDependencyOfAnyPath(packageName, paths, context)) {
                return ChangelogGenerator.SECURITY_ENHANCEMENTS_MESSAGE;
            }
        }
        return message;
    }

    /**
     * Combine commits that have the exact same message into a single entry so we can list all of their
     * reflinks together (i.e. `Security enhancements (#196, #198)`). The first occurrence of a message
     * determines the position of the group in the list, and each group's reflinks are sorted by ascending
     * pr number (commits without a pr number are listed last).
     */
    private groupCommitsByMessage(commits: Commit[], context?: CommitContext) {
        const groups: Array<{ message: string; commits: Commit[] }> = [];
        const groupsByMessage = new Map<string, { message: string; commits: Commit[] }>();
        for (const commit of commits) {
            const message = this.normalizeCommitMessage(commit.message, context);
            let group = groupsByMessage.get(message);
            if (!group) {
                group = { message: message, commits: [] };
                groupsByMessage.set(message, group);
                groups.push(group);
            }
            group.commits.push(commit);
        }
        //sort each group's commits by ascending pr number. commits without a pr number go last, in their original order
        for (const group of groups) {
            group.commits = group.commits.map((commit, index) => ({ commit: commit, index: index })).sort((a, b) => {
                const aPr = parseInt(a.commit.prNumber);
                const bPr = parseInt(b.commit.prNumber);
                if (isNaN(aPr) && isNaN(bPr)) {
                    return a.index - b.index;
                } else if (isNaN(aPr)) {
                    return 1;
                } else if (isNaN(bPr)) {
                    return -1;
                }
                return aPr - bPr;
            }).map(x => x.commit);
        }
        return groups;
    }

    private computeChanges(project: Project) {
        project.changes.push(
            ...this.getCommitLogs(project.name, project.lastTag, 'HEAD')
        );
        //get commits from any changed dependencies
        for (const dependency of [...project.dependencies, ...project.devDependencies]) {
            //the dependency has changed
            if (dependency.hasChanged()) {
                project.changes.push(
                    ...this.getCommitLogs(dependency.repoName, dependency.previousReleaseVersion, dependency.newVersion)
                );
            }
        }
    }

    private getCommitLogs(projectName: string, startVersion: string, endVersion: string) {
        if (utils.isVersion(startVersion)) {
            startVersion = startVersion.startsWith('v') ? startVersion : 'v' + startVersion;
        }
        endVersion = endVersion.startsWith('v') || endVersion === 'HEAD' ? endVersion : 'v' + endVersion;
        let project = ProjectManager.getProject(projectName);
        utils.executeCommand(`git tag --list`, { cwd: project?.dir });
        const commitMessages = utils.executeCommandWithOutput(
            `git log ${startVersion}...${endVersion} --oneline --first-parent`,
            { cwd: project?.dir }
        ).toString()
            .split(/\r?\n/g)
            //exclude empty lines
            .filter(x => x.trim())
            .map(x => {
                const [, hash, branchInfo, message, prNumber] = /\s*([a-z0-9]+)\s*(?:\((.*?)\))?\s*(.*?)\s*(?:\(#(\d+)\))?$/gm.exec(x) ?? [];
                return {
                    hash: hash,
                    branchInfo: branchInfo,
                    message: message ?? x,
                    prNumber: prNumber
                };
            })
            //exclude version-only commit messages
            .filter(x => !semver.valid(x.message))
            //exclude those "update changelog for..." message
            .filter(x => !x.message.toLowerCase().startsWith('update changelog for '))
            //exclude merge commits
            .filter(x => !/^Merge branch '.*?' of.*?into.*?/.test(x.message));

        return commitMessages;
    }

    private keywordToSectionMap: Record<ChangelogSection, string[]> = {
        Added: ['add', 'adds', 'added', 'new', 'create', 'creates', 'created'],
        Changed: ['change', 'changes', 'changed', 'update', 'updates', 'updated'],
        Deprecated: ['deprecate', 'deprecates', 'deprecated'],
        Fixed: ['fix', 'fixes', 'fixed', 'resolve', 'resolves', 'resolved'],
        Removed: ['remove', 'removes', 'removed', 'delete', 'deletes', 'deleted'],
        Chore: ['chore', '(chore)']
    };

    private getChangelogHeaderForMessage(commitMessage: string): ChangelogSection | undefined {
        const lowerMessage = commitMessage.toLowerCase();

        for (const [section, keywords] of Object.entries(this.keywordToSectionMap)) {
            for (const keyword of keywords) {
                if (lowerMessage.startsWith(keyword)) {
                    return section as ChangelogSection;
                }
            }
        }
    }
}

type ChangelogSection = 'Added' | 'Changed' | 'Deprecated' | 'Fixed' | 'Removed' | 'Chore';

/**
 * Where a set of commits came from, so we can inspect that repo's manifests at the matching ref
 */
interface CommitContext {
    dir: string;
    ref: string;
}
