/* eslint-disable camelcase */
import { expect } from 'chai';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { createSandbox } from 'sinon';
import { ProjectManager, Project, ProjectDependency } from './ProjectManager';
import { utils } from './utils';
import { createMockProject } from './test-helpers';

chai.use(chaiAsPromised);

const sinon = createSandbox();

describe('ProjectManager', () => {
    beforeEach(() => {
        sinon.restore();
        // Reset the singleton instance
        (ProjectManager as any).instance = undefined;
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('getPreviousVersion', () => {
        it('returns the previous release version', () => {
            let tags = [
                'v1.0.0',
                'v0.9.0',
                'v0.8.0'
            ];
            sinon.stub(utils, 'executeCommandWithOutput').callsFake((cmd: string) => {
                if (cmd === `git tag --merged HEAD`) {
                    return tags.join('\n');
                }
                return '';
            });

            expect(ProjectManager.getPreviousVersion('1.0.1', '')).to.equal('1.0.0');
            expect(ProjectManager.getPreviousVersion('0.9.1', '')).to.equal('0.9.0');
            expect(ProjectManager.getPreviousVersion('0.8.9', '')).to.equal('0.8.0');
            expect(ProjectManager.getPreviousVersion('0.1.0', '')).to.equal(undefined);
        });

        it('handles prerelease versions', () => {
            sinon.stub(utils, 'executeCommandWithOutput').callsFake((cmd: string) => {
                if (cmd === `git tag --merged HEAD`) {
                    return tags.join('\n');
                }
                return '';
            });

            let tags = [
                'v0.9.9',
                'v0.9.0',
                'v0.8.0'
            ];
            expect(ProjectManager.getPreviousVersion('1.0.0-alpha.0', '')).to.equal('0.9.9');

            tags = [
                'v1.0.0-alpha.0',
                'v1.0.0',
                'v0.9.0',
                'v0.8.0'
            ];
            expect(ProjectManager.getPreviousVersion('1.0.0-alpha.1', '')).to.equal('1.0.0-alpha.0');

            tags = [
                'v0.9.2',
                'v0.9.1',
                'v0.9.0',
                'v1.0.0-alpha.0',
                'v0.9.0',
                'v0.8.0'
            ];
            expect(ProjectManager.getPreviousVersion('1.0.0-alpha.1', '')).to.equal('1.0.0-alpha.0');
        });

        it('returns undefined when no previous version exists', () => {
            sinon.stub(utils, 'executeCommandWithOutput').returns('');

            expect(ProjectManager.getPreviousVersion('1.0.0', '')).to.equal(undefined);
        });
    });

    describe('getProject', () => {
        it('returns undefined for unknown project', () => {
            const result = ProjectManager.getProject('unknown-project');

            expect(result).to.be.undefined;
        });
    });

    describe('Project class', () => {
        it('initializes with correct default values', () => {
            const project = new Project('test', '@test/project', 'https://github.com/test/repo');

            expect(project.name).to.equal('test');
            expect(project.npmName).to.equal('@test/project');
            expect(project.repositoryUrl).to.equal('https://github.com/test/repo');
            expect(project.version).to.equal('');
            expect(project.dependencies).to.deep.equal([]);
            expect(project.devDependencies).to.deep.equal([]);
            expect(project.changes).to.deep.equal([]);
        });
    });

    describe('ProjectDependency class', () => {
        it('initializes with correct values', () => {
            const dep = new ProjectDependency('pkg', 'repo', '1.0.0', '1.1.0', 'https://github.com/test/repo');

            expect(dep.name).to.equal('pkg');
            expect(dep.repoName).to.equal('repo');
            expect(dep.previousReleaseVersion).to.equal('1.0.0');
            expect(dep.newVersion).to.equal('1.1.0');
            expect(dep.repositoryUrl).to.equal('https://github.com/test/repo');
        });

        it('hasChanged returns truthy when versions differ', () => {
            const dep = new ProjectDependency('pkg', 'repo', '1.0.0', '1.1.0', 'https://github.com/test/repo');

            expect(dep.hasChanged()).to.be.ok;
        });

        it('hasChanged returns falsy when versions are the same', () => {
            const dep = new ProjectDependency('pkg', 'repo', '1.0.0', '1.0.0', 'https://github.com/test/repo');

            expect(dep.hasChanged()).to.not.be.ok;
        });

        it('hasChanged returns falsy for invalid semver', () => {
            const dep = new ProjectDependency('pkg', 'repo', 'invalid', '1.0.0', 'https://github.com/test/repo');

            expect(dep.hasChanged()).to.not.be.ok;
        });
    });

    describe('innerInstallDependencies', () => {
        /**
         * Wires up stubs for the commands `innerInstallDependencies` shells out to, and records every `npm install` it performs.
         */
        function setupInstallStubs(options: {
            /**
             * The versions published to npm, keyed by package name. Used to answer `npm show <name> versions --json`,
             * `npm show <name>@<version> version` and `npm view <name>@<version>`
             */
            registry: Record<string, string[]>;
            /**
             * The version of each dependency found in the previous release's package.json
             */
            previousVersions: Record<string, string>;
        }) {
            const installs: string[] = [];

            const resolve = (packageName: string, versionOrTag: string) => {
                const versions = options.registry[packageName] ?? [];
                if (versionOrTag === 'latest') {
                    //npm's `latest` tag points at the newest _stable_ version
                    return [...versions].reverse().find(x => !x.includes('-'));
                }
                return versions.find(x => x === versionOrTag);
            };

            sinon.stub(utils, 'executeCommand').callsFake((command: string) => {
                const match = /^npm install (\S+)@(\S+)$/.exec(command);
                if (match) {
                    installs.push(`${match[1]}@${resolve(match[1], match[2])}`);
                }
            });

            sinon.stub(utils, 'executeCommandSucceeds').callsFake((command: string) => {
                const match = /^npm view (\S+)@(\S+)$/.exec(command);
                if (match) {
                    return !!resolve(match[1], match[2]);
                }
                return true;
            });

            const executeCommandWithOutput = (command: string) => {
                let match = /^npm show (\S+) versions --json$/.exec(command);
                if (match) {
                    return options.registry[match[1]] ? JSON.stringify(options.registry[match[1]]) : '';
                }
                match = /^npm show (\S+)@(\S+) version$/.exec(command);
                if (match) {
                    return resolve(match[1], match[2]) ?? '';
                }
                if (command === 'git rev-list --max-parents=0 HEAD') {
                    return 'abc1234';
                }
                return '';
            };
            sinon.stub(utils, 'executeCommandWithOutput').callsFake(executeCommandWithOutput as any);
            sinon.stub(utils, 'tryExecuteCommandWithOutput').callsFake(executeCommandWithOutput as any);

            //`getDependencyVersionFromRelease` reads the previous release's package.json out of git
            sinon.stub(ProjectManager.prototype as any, 'getDependencyVersionFromRelease').callsFake((project, releaseVersion, packageName) => {
                return options.previousVersions[packageName as string] ?? '';
            });

            //after `npm install`, the code reads the installed version back out of node_modules
            sinon.stub(ProjectManager, 'getInstalledVersion').callsFake((project, packageName: string) => {
                const installed = installs.find(x => x.startsWith(`${packageName}@`));
                //if nothing was installed, node_modules still holds whatever the previous release pinned
                return installed ? installed.split('@').pop() : options.previousVersions[packageName];
            });

            return installs;
        }

        function createProject(version: string, dependencies: string[], devDependencies: string[] = []) {
            return createMockProject({
                version: version,
                dependencies: dependencies.map(name => new ProjectDependency(name, name, '', '', '')),
                devDependencies: devDependencies.map(name => new ProjectDependency(name, name, '', '', ''))
            });
        }

        it('does nothing to versions when installDependencies is false', () => {
            const installs = setupInstallStubs({
                registry: { 'roku-deploy': ['3.12.0', '3.12.1'] },
                previousVersions: { 'roku-deploy': '3.12.0' }
            });
            const project = createProject('1.0.0', ['roku-deploy']);

            ProjectManager.innerInstallDependencies(project, '0.9.0', false);

            expect(installs).to.eql([]);
            expect(project.dependencies[0].newVersion).to.equal('3.12.0');
        });

        it('installs the latest stable version for a stable project with stable dependencies', () => {
            const installs = setupInstallStubs({
                registry: { 'roku-deploy': ['3.12.0', '3.12.1', '3.12.2'] },
                previousVersions: { 'roku-deploy': '3.12.0' }
            });
            const project = createProject('1.0.0', ['roku-deploy']);

            ProjectManager.innerInstallDependencies(project, '0.9.0', true);

            expect(installs).to.eql(['roku-deploy@3.12.2']);
            expect(project.dependencies[0].newVersion).to.equal('3.12.2');
        });

        it('installs devDependencies too', () => {
            const installs = setupInstallStubs({
                registry: {
                    'roku-deploy': ['3.12.0', '3.12.1'],
                    'brighterscript': ['0.65.0', '0.65.1']
                },
                previousVersions: { 'roku-deploy': '3.12.0', 'brighterscript': '0.65.0' }
            });
            const project = createProject('1.0.0', ['roku-deploy'], ['brighterscript']);

            ProjectManager.innerInstallDependencies(project, '0.9.0', true);

            expect(installs).to.eql(['roku-deploy@3.12.1', 'brighterscript@0.65.1']);
        });

        it('refuses to downgrade a dependency', () => {
            const installs = setupInstallStubs({
                //`latest` resolves to 3.12.0 which is older than what the previous release pinned
                registry: { 'roku-deploy': ['3.12.0'] },
                previousVersions: { 'roku-deploy': '3.13.0' }
            });
            const project = createProject('1.0.0', ['roku-deploy']);

            ProjectManager.innerInstallDependencies(project, '0.9.0', true);

            expect(installs).to.eql([]);
        });

        it('skips installation when npm has no version to offer', () => {
            const installs = setupInstallStubs({
                registry: {},
                previousVersions: { 'roku-deploy': '3.13.0' }
            });
            const project = createProject('1.0.0', ['roku-deploy']);

            ProjectManager.innerInstallDependencies(project, '0.9.0', true);

            expect(installs).to.eql([]);
        });

        describe('lockstep', () => {
            it('bumps a matching prerelease dependency to the same next prerelease number', () => {
                const installs = setupInstallStubs({
                    registry: { 'roku-deploy': ['3.12.0', '4.0.0-alpha.3', '4.0.0-alpha.4'] },
                    previousVersions: { 'roku-deploy': '4.0.0-alpha.3' }
                });
                const project = createProject('1.0.0-alpha.3', ['roku-deploy']);

                ProjectManager.innerInstallDependencies(project, '1.0.0-alpha.2', true);

                expect(installs).to.eql(['roku-deploy@4.0.0-alpha.4']);
            });

            it('stays on the lockstep version even when a newer prerelease exists', () => {
                const installs = setupInstallStubs({
                    registry: { 'roku-deploy': ['4.0.0-alpha.3', '4.0.0-alpha.4', '4.0.0-alpha.5'] },
                    previousVersions: { 'roku-deploy': '4.0.0-alpha.3' }
                });
                const project = createProject('1.0.0-alpha.3', ['roku-deploy']);

                ProjectManager.innerInstallDependencies(project, '1.0.0-alpha.2', true);

                //lockstep means alpha.3 -> alpha.4, NOT "jump to the newest alpha"
                expect(installs).to.eql(['roku-deploy@4.0.0-alpha.4']);
            });

            it('keeps the current prerelease when the lockstep version has not been published yet', () => {
                const installs = setupInstallStubs({
                    registry: { 'roku-deploy': ['3.12.0', '4.0.0-alpha.3'] },
                    previousVersions: { 'roku-deploy': '4.0.0-alpha.3' }
                });
                const project = createProject('1.0.0-alpha.3', ['roku-deploy']);

                ProjectManager.innerInstallDependencies(project, '1.0.0-alpha.2', true);

                //alpha.4 does not exist, so we fall back to `latest`, which is a downgrade and gets skipped
                expect(installs).to.eql([]);
            });

            it('does not lockstep a dependency on a different prerelease number', () => {
                const installs = setupInstallStubs({
                    registry: { 'roku-deploy': ['4.0.0-alpha.1', '4.0.0-alpha.2', '4.0.0-alpha.3'] },
                    previousVersions: { 'roku-deploy': '4.0.0-alpha.1' }
                });
                const project = createProject('1.0.0-alpha.3', ['roku-deploy']);

                ProjectManager.innerInstallDependencies(project, '1.0.0-alpha.2', true);

                //the project is on alpha.3 but the dependency is on alpha.1, so there is no lockstep to hold.
                //It should still catch up to the newest alpha rather than being skipped as a downgrade.
                expect(installs).to.eql(['roku-deploy@4.0.0-alpha.3']);
            });

            it('leaves a stable dependency on `latest` for a prerelease project', () => {
                const installs = setupInstallStubs({
                    registry: { 'roku-deploy': ['3.12.0', '3.12.1'] },
                    previousVersions: { 'roku-deploy': '3.12.0' }
                });
                const project = createProject('1.0.0-alpha.3', ['roku-deploy']);

                ProjectManager.innerInstallDependencies(project, '1.0.0-alpha.2', true);

                expect(installs).to.eql(['roku-deploy@3.12.1']);
            });
        });

        describe('prerelease dependency of a stable project', () => {
            it('upgrades to the newest version on the same prerelease line', () => {
                const installs = setupInstallStubs({
                    //this is the real roku-debug@0.x -> roku-deploy@4.0.0-alpha.3 case
                    registry: { 'roku-deploy': ['3.12.0', '3.18.4', '4.0.0-alpha.3', '4.0.0-alpha.4', '4.0.0-alpha.5'] },
                    previousVersions: { 'roku-deploy': '4.0.0-alpha.3' }
                });
                const project = createProject('0.21.0', ['roku-deploy']);

                ProjectManager.innerInstallDependencies(project, '0.20.0', true);

                expect(installs).to.eql(['roku-deploy@4.0.0-alpha.5']);
                expect(project.dependencies[0].newVersion).to.equal('4.0.0-alpha.5');
            });

            it('leaves the dependency alone when it is already on the newest prerelease', () => {
                const installs = setupInstallStubs({
                    registry: { 'roku-deploy': ['3.18.4', '4.0.0-alpha.3'] },
                    previousVersions: { 'roku-deploy': '4.0.0-alpha.3' }
                });
                const project = createProject('0.21.0', ['roku-deploy']);

                ProjectManager.innerInstallDependencies(project, '0.20.0', true);

                //nothing newer on the alpha line, and `latest` (3.18.4) would be a downgrade
                expect(installs).to.eql([]);
            });

            it('does not cross to a different prerelease identifier', () => {
                const installs = setupInstallStubs({
                    registry: { 'roku-deploy': ['4.0.0-alpha.3', '4.0.0-beta.0', '4.0.0-beta.1'] },
                    previousVersions: { 'roku-deploy': '4.0.0-alpha.3' }
                });
                const project = createProject('0.21.0', ['roku-deploy']);

                ProjectManager.innerInstallDependencies(project, '0.20.0', true);

                expect(installs).to.eql([]);
            });

            it('does not cross to a different major.minor.patch', () => {
                const installs = setupInstallStubs({
                    registry: { 'roku-deploy': ['4.0.0-alpha.3', '4.1.0-alpha.0', '5.0.0-alpha.0'] },
                    previousVersions: { 'roku-deploy': '4.0.0-alpha.3' }
                });
                const project = createProject('0.21.0', ['roku-deploy']);

                ProjectManager.innerInstallDependencies(project, '0.20.0', true);

                expect(installs).to.eql([]);
            });

            it('applies to devDependencies as well', () => {
                const installs = setupInstallStubs({
                    registry: { 'roku-deploy': ['4.0.0-alpha.3', '4.0.0-alpha.4'] },
                    previousVersions: { 'roku-deploy': '4.0.0-alpha.3' }
                });
                const project = createProject('0.21.0', [], ['roku-deploy']);

                ProjectManager.innerInstallDependencies(project, '0.20.0', true);

                expect(installs).to.eql(['roku-deploy@4.0.0-alpha.4']);
            });
        });
    });

    describe('getLatestPrereleaseVersion', () => {
        let project: Project;

        beforeEach(() => {
            project = createMockProject();
        });

        function stubVersions(versions: string[] | string | undefined) {
            sinon.stub(utils, 'tryExecuteCommandWithOutput').callsFake(() => {
                return versions === undefined ? '' : JSON.stringify(versions);
            });
        }

        it('returns undefined for a stable current version', () => {
            stubVersions(['1.0.0', '1.0.1']);
            expect(ProjectManager.getLatestPrereleaseVersion(project, 'roku-deploy', '1.0.0')).to.be.undefined;
        });

        it('returns the newest version on the same prerelease line', () => {
            stubVersions(['4.0.0-alpha.3', '4.0.0-alpha.4', '4.0.0-alpha.5']);
            expect(ProjectManager.getLatestPrereleaseVersion(project, 'roku-deploy', '4.0.0-alpha.3')).to.equal('4.0.0-alpha.5');
        });

        it('ignores stable versions', () => {
            stubVersions(['4.0.0-alpha.3', '4.0.0-alpha.4', '5.0.0']);
            expect(ProjectManager.getLatestPrereleaseVersion(project, 'roku-deploy', '4.0.0-alpha.3')).to.equal('4.0.0-alpha.4');
        });

        it('ignores a different prerelease identifier', () => {
            stubVersions(['4.0.0-alpha.3', '4.0.0-beta.9']);
            expect(ProjectManager.getLatestPrereleaseVersion(project, 'roku-deploy', '4.0.0-alpha.3')).to.be.undefined;
        });

        it('ignores older versions on the same line', () => {
            stubVersions(['4.0.0-alpha.0', '4.0.0-alpha.1', '4.0.0-alpha.3']);
            expect(ProjectManager.getLatestPrereleaseVersion(project, 'roku-deploy', '4.0.0-alpha.3')).to.be.undefined;
        });

        it('handles a single-version package returned as a bare string', () => {
            stubVersions('4.0.0-alpha.4');
            expect(ProjectManager.getLatestPrereleaseVersion(project, 'roku-deploy', '4.0.0-alpha.3')).to.equal('4.0.0-alpha.4');
        });

        it('returns undefined when npm returns nothing', () => {
            stubVersions(undefined);
            expect(ProjectManager.getLatestPrereleaseVersion(project, 'roku-deploy', '4.0.0-alpha.3')).to.be.undefined;
        });

        it('returns undefined when npm returns unparsable output', () => {
            sinon.stub(utils, 'tryExecuteCommandWithOutput').callsFake(() => 'not json');
            expect(ProjectManager.getLatestPrereleaseVersion(project, 'roku-deploy', '4.0.0-alpha.3')).to.be.undefined;
        });

        it('ignores invalid version strings in the list', () => {
            stubVersions(['not-a-version', '4.0.0-alpha.4']);
            expect(ProjectManager.getLatestPrereleaseVersion(project, 'roku-deploy', '4.0.0-alpha.3')).to.equal('4.0.0-alpha.4');
        });
    });
});
