/* eslint-disable camelcase */
import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { utils } from './utils';
import { ChangelogGenerator } from './ChangeLogGenerator';
import { ProjectManager, Project, ProjectDependency } from './ProjectManager';

const sinon = createSandbox();
const changelogGenerator = new ChangelogGenerator();

describe('Test ReleaseCreator.ts', () => {
    beforeEach(() => {
        sinon.restore();
    });

    afterEach(() => {
        sinon.restore();
    });

    it('Successfully creates change logs', () => {
        const changes = [
            'fixed a bug',
            'added a feature',
            'chore: updated dependencies',
            'updated documentation',
            'fixed linting issues',
            'refactored code',
            'improved performance',
            'added tests',
            'updated build process'
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake((projectName: string, startVersion: string, endVersion: string) => {
            return changes.map((change) => {
                return {
                    hash: '',
                    branchInfo: '',
                    message: change,
                    prNumber: ''
                };
            });
        });
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            return {
                name: '',
                npmName: '',
                repositoryUrl: '',
                dir: '',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: changes.map((change) => {
                    return { message: change, hash: '', branchInfo: '', prNumber: '' };
                }),
                lastTag: ''
            };
        });
        const lines = changelog['getChangeLogs'](new Project('test', '', ''), '1.0.0');
        expect(lines[4]).to.contain('## [1.0.0]');
        expect(lines[5]).to.contain('### Added');
        expect(lines[6]).to.contain('added a feature');
        expect(lines[7]).to.contain('added tests');
        expect(lines[8]).to.contain('### Changed');
        expect(lines[9]).to.contain('updated documentation');
        expect(lines[10]).to.contain('refactored code');
        expect(lines[11]).to.contain('improved performance');
        expect(lines[12]).to.contain('updated build process');
        expect(lines[13]).to.contain('### Fixed');
        expect(lines[14]).to.contain('fixed a bug');
        expect(lines[15]).to.contain('fixed linting issues');

    });

    it('Successfully creates change logs with updated dependencies', () => {
        const changes = [
            'fixed a bug',
            'added a feature',
            'chore: updated dependencies',
            'updated documentation',
            'fixed linting issues',
            'refactored code',
            'improved performance',
            'added tests',
            'updated build process'
        ];
        const depChanges = [
            'fixed dep change',
            'added feature in dep'
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake((projectName: string, startVersion: string, endVersion: string) => {
            if (projectName === 'testDep') {
                return depChanges.map((change) => {
                    return {
                        hash: '',
                        branchInfo: '',
                        message: change,
                        prNumber: ''
                    };
                });
            } else {
                return changes.map((change) => {
                    return {
                        hash: '',
                        branchInfo: '',
                        message: change,
                        prNumber: ''
                    };
                });
            }
        });
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            if (name === 'testDep') {
                return {
                    name: '',
                    npmName: '',
                    repositoryUrl: '',
                    dir: '',
                    version: '',
                    dependencies: [],
                    devDependencies: [],
                    changes: depChanges.map((change) => {
                        return { message: change, hash: '', branchInfo: '', prNumber: '' };
                    }),
                    lastTag: ''
                };
            } else {
                return {
                    name: '',
                    npmName: '',
                    repositoryUrl: '',
                    dir: '',
                    version: '',
                    dependencies: [new ProjectDependency(
                        'testDep',
                        '1.0.0',
                        '1.0.1',
                        'testDep',
                        ''
                    )],
                    devDependencies: [],
                    changes: changes.map((change) => {
                        return { message: change, hash: '', branchInfo: '', prNumber: '' };
                    }),
                    lastTag: ''
                };
            }
        });
        const lines = changelog['getChangeLogs'](new Project('test', '', ''), '1.0.0');
        expect(lines[4]).to.contain('## [1.0.0]');
        expect(lines[5]).to.contain('### Added');
        expect(lines[6]).to.contain('added a feature');
        expect(lines[7]).to.contain('added tests');
        expect(lines[8]).to.contain('### Changed');
        expect(lines[9]).to.contain('updated documentation');
        expect(lines[10]).to.contain('refactored code');
        expect(lines[11]).to.contain('improved performance');
        expect(lines[12]).to.contain('updated build process');
        expect(lines[13]).to.contain('### Fixed');
        expect(lines[14]).to.contain('fixed a bug');
        expect(lines[15]).to.contain('fixed linting issues');

    });

    it('combines commits that have the exact same message', () => {
        const commits = [
            { message: 'Security enhancements', prNumber: '198' },
            { message: 'fix: restrict CreateObject component usage detection', prNumber: '197' },
            { message: 'Security enhancements', prNumber: '196' }
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake(() => {
            return commits.map(x => ({ hash: '', branchInfo: '', message: x.message, prNumber: x.prNumber }));
        });
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            return {
                name: 'bslint',
                npmName: '',
                repositoryUrl: 'https://github.com/rokucommunity/bslint',
                dir: '',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: [],
                lastTag: ''
            };
        });
        const lines = changelog['getChangeLogs'](new Project('bslint', '', 'https://github.com/rokucommunity/bslint'), '1.0.0');
        expect(lines.slice(5)).to.eql([
            '### Changed',
            ' - Security enhancements ([#196](https://github.com/rokucommunity/bslint/pull/196), [#198](https://github.com/rokucommunity/bslint/pull/198))',
            '### Fixed',
            ' - fix: restrict CreateObject component usage detection ([#197](https://github.com/rokucommunity/bslint/pull/197))'
        ]);
    });

    it('combines duplicate dependency commit messages', () => {
        const depCommits = [
            { message: 'Security enhancements', prNumber: '1766' },
            { message: 'Security enhancements', prNumber: '1764' },
            { message: 'added a dep feature', prNumber: '1763' }
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake((projectName: string) => {
            if (projectName === 'brighterscript') {
                return depCommits.map(x => ({ hash: '', branchInfo: '', message: x.message, prNumber: x.prNumber }));
            }
            return [];
        });
        sinon.stub(changelog as any, 'getVersionDate').returns('2026-09-02');
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            return {
                name: name,
                npmName: '',
                repositoryUrl: `https://github.com/rokucommunity/${name}`,
                dir: '',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: [],
                lastTag: ''
            };
        });
        const project = new Project('bslint', '', 'https://github.com/rokucommunity/bslint');
        project.dependencies = [new ProjectDependency(
            'brighterscript',
            'brighterscript',
            '0.72.5',
            '0.73.1',
            'https://github.com/rokucommunity/brighterscript'
        )];
        const lines = changelog['getChangeLogs'](project, '1.0.0');
        expect(lines.slice(6)).to.eql([
            ' - upgrade to [brighterscript@0.73.1](https://github.com/rokucommunity/brighterscript/blob/master/CHANGELOG.md#0731---2026-09-02). Notable changes since 0.72.5:',
            '     - Security enhancements ([#1764](https://github.com/rokucommunity/brighterscript/pull/1764), [#1766](https://github.com/rokucommunity/brighterscript/pull/1766))',
            '     - added a dep feature ([#1763](https://github.com/rokucommunity/brighterscript/pull/1763))'
        ]);
    });

    it('merges dependabot bump commits into the security enhancements entry', () => {
        const commits = [
            { message: 'Bump qs from 6.14.2 to 6.15.3', prNumber: '1766' },
            { message: 'Security enhancements', prNumber: '198' },
            { message: 'Bump postcss from 8.5.10 to 8.5.25', prNumber: '1764' },
            { message: 'security enhancements', prNumber: '196' },
            { message: 'Bump form-data from 2.5.5 to 2.5.6', prNumber: '1733' },
            { message: 'Bump the version of the docs site', prNumber: '150' }
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake(() => {
            return commits.map(x => ({ hash: '', branchInfo: '', message: x.message, prNumber: x.prNumber }));
        });
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            return {
                name: 'bslint',
                npmName: '',
                repositoryUrl: 'https://github.com/rokucommunity/bslint',
                dir: '',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: [],
                lastTag: ''
            };
        });
        const lines = changelog['getChangeLogs'](new Project('bslint', '', 'https://github.com/rokucommunity/bslint'), '1.0.0');
        expect(lines.slice(5)).to.eql([
            '### Changed',
            ' - Security enhancements ([#196](https://github.com/rokucommunity/bslint/pull/196), [#198](https://github.com/rokucommunity/bslint/pull/198), [#1733](https://github.com/rokucommunity/bslint/pull/1733), [#1764](https://github.com/rokucommunity/bslint/pull/1764), [#1766](https://github.com/rokucommunity/bslint/pull/1766))',
            //this one isn't a `bump <pkg> from <version> to <version>` message, so it stays on its own
            ' - Bump the version of the docs site ([#150](https://github.com/rokucommunity/bslint/pull/150))'
        ]);
    });

    it('combines commits without pr numbers using commit hashes', () => {
        const commits = [
            { hash: 'aaa1111', message: 'Security enhancements' },
            { hash: 'bbb2222', message: 'Security enhancements' }
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake(() => {
            return commits.map(x => ({ hash: x.hash, branchInfo: '', message: x.message, prNumber: undefined }));
        });
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            return {
                name: 'bslint',
                npmName: '',
                repositoryUrl: 'https://github.com/rokucommunity/bslint',
                dir: '',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: [],
                lastTag: ''
            };
        });
        const lines = changelog['getChangeLogs'](new Project('bslint', '', 'https://github.com/rokucommunity/bslint'), '1.0.0');
        expect(lines.slice(5)).to.eql([
            '### Changed',
            ' - Security enhancements ([aaa1111](https://github.com/rokucommunity/bslint/commit/aaa1111), [bbb2222](https://github.com/rokucommunity/bslint/commit/bbb2222))'
        ]);
    });
});
