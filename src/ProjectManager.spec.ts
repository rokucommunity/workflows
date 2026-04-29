/* eslint-disable camelcase */
import { expect } from 'chai';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { createSandbox } from 'sinon';
import { ProjectManager, Project, ProjectDependency } from './ProjectManager';
import { utils } from './utils';

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
            const dep = new ProjectDependency('pkg', 'repo', '1.0.0', '1.1.0');

            expect(dep.name).to.equal('pkg');
            expect(dep.repoName).to.equal('repo');
            expect(dep.previousReleaseVersion).to.equal('1.0.0');
            expect(dep.newVersion).to.equal('1.1.0');
        });

        it('hasChanged returns truthy when versions differ', () => {
            const dep = new ProjectDependency('pkg', 'repo', '1.0.0', '1.1.0');

            expect(dep.hasChanged()).to.be.ok;
        });

        it('hasChanged returns falsy when versions are the same', () => {
            const dep = new ProjectDependency('pkg', 'repo', '1.0.0', '1.0.0');

            expect(dep.hasChanged()).to.not.be.ok;
        });

        it('hasChanged returns falsy for invalid semver', () => {
            const dep = new ProjectDependency('pkg', 'repo', 'invalid', '1.0.0');

            expect(dep.hasChanged()).to.not.be.ok;
        });
    });
});
