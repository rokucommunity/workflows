/* eslint-disable camelcase */
import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { utils } from './utils';
import { ChangelogGenerator } from './ChangeLogGenerator';
import { ProjectManager, Project } from './ProjectManager';

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
                    dependencies: [{
                        name: 'testDep',
                        previousReleaseVersion: '1.0.0',
                        newVersion: '1.0.1',
                        repoName: 'testDep'
                    }],
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
});
