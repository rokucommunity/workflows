/* eslint-disable camelcase */
import { expect } from 'chai';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { createSandbox } from 'sinon';
import { ReleaseCreator } from './ReleaseCreator';
import { utils } from './utils';
import { ProjectManager } from './ProjectManager';
import { createMockRelease, createMockAsset, createMockProject } from './test-helpers';
import * as fastGlob from 'fast-glob';

chai.use(chaiAsPromised);

const sinon = createSandbox();
let releaseCreator: ReleaseCreator;

describe('ReleaseCreator', () => {
    beforeEach(() => {
        sinon.restore();
        releaseCreator = new ReleaseCreator();
    });

    afterEach(() => {
        sinon.restore();
    });

    describe('assertSingleRelease', () => {
        it('returns release when exactly one matches tag', async () => {
            const mockRelease = createMockRelease({ tag_name: 'v1.0.0' });
            sinon.stub(releaseCreator as any, 'listGitHubReleases').resolves([mockRelease]);

            const result = await (releaseCreator as any).assertSingleRelease('test-project', 'v1.0.0');

            expect(result).to.deep.equal(mockRelease);
        });

        it('throws "No release found" when no releases exist', async () => {
            sinon.stub(releaseCreator as any, 'listGitHubReleases').resolves([]);

            await expect(
                (releaseCreator as any).assertSingleRelease('test-project', 'v1.0.0')
            ).to.be.rejectedWith('No release found with tag v1.0.0');
        });

        it('throws "No release found" when no tags match', async () => {
            const mockRelease = createMockRelease({ tag_name: 'v2.0.0' });
            sinon.stub(releaseCreator as any, 'listGitHubReleases').resolves([mockRelease]);

            await expect(
                (releaseCreator as any).assertSingleRelease('test-project', 'v1.0.0')
            ).to.be.rejectedWith('No release found with tag v1.0.0');
        });

        it('throws with count and links when multiple releases match', async () => {
            const releases = [
                createMockRelease({ id: 1, tag_name: 'v1.0.0', draft: true, html_url: 'https://github.com/test/releases/1', assets: [] }),
                createMockRelease({ id: 2, tag_name: 'v1.0.0', draft: false, html_url: 'https://github.com/test/releases/2', assets: [createMockAsset()] })
            ];
            sinon.stub(releaseCreator as any, 'listGitHubReleases').resolves(releases);

            try {
                await (releaseCreator as any).assertSingleRelease('test-project', 'v1.0.0');
                expect.fail('Expected error to be thrown');
            } catch (e: any) {
                expect(e.message).to.match(/Found 2 releases with tag v1.0.0/);
                expect(e.message).to.match(/https:\/\/github.com\/test\/releases\/1/);
            }
        });

        it('filters by exact tag match (v1.0.0 vs v1.0.0-beta)', async () => {
            const releases = [
                createMockRelease({ tag_name: 'v1.0.0' }),
                createMockRelease({ tag_name: 'v1.0.0-beta' })
            ];
            sinon.stub(releaseCreator as any, 'listGitHubReleases').resolves(releases);

            const result = await (releaseCreator as any).assertSingleRelease('test-project', 'v1.0.0');

            expect(result.tag_name).to.equal('v1.0.0');
        });
    });

    describe('verifyReleaseAssets', () => {
        let initializeStub: sinon.SinonStub;
        let executeCommandStub: sinon.SinonStub;

        beforeEach(() => {
            const mockProject = createMockProject();
            initializeStub = sinon.stub(ProjectManager, 'initialize').resolves(mockProject);
            executeCommandStub = sinon.stub(utils, 'executeCommand');
        });

        it('succeeds when assets exist', async () => {
            sinon.stub(releaseCreator as any, 'getVersion').resolves('1.0.0');
            sinon.stub(releaseCreator as any, 'assertSingleRelease').resolves(createMockRelease({ id: 1 }));
            sinon.stub(utils, 'octokitPageHelper').resolves([createMockAsset()]);

            // Should not throw
            await releaseCreator.verifyReleaseAssets({ projectName: 'test-project', ref: 'release/1.0.0' });
        });

        it('throws descriptive error with re-run instructions when no assets exist', async () => {
            sinon.stub(releaseCreator as any, 'getVersion').resolves('1.0.0');
            sinon.stub(releaseCreator as any, 'assertSingleRelease').resolves(createMockRelease({ id: 1 }));
            sinon.stub(utils, 'octokitPageHelper').resolves([]);

            try {
                await releaseCreator.verifyReleaseAssets({ projectName: 'test-project', ref: 'release/1.0.0' });
                expect.fail('Expected error to be thrown');
            } catch (e: any) {
                expect(e.message).to.match(/Release v1.0.0 has no assets!/);
                expect(e.message).to.match(/Re-run the 'Make Release Artifacts' workflow/);
            }
        });
    });

    describe('getVersion', () => {
        it('reads version from package.json', async () => {
            // Use the real package.json in this repo
            const result = await (releaseCreator as any).getVersion(process.cwd());

            expect(result).to.match(/^\d+\.\d+\.\d+/);
        });
    });

    describe('getNewVersion', () => {
        it('returns customVersion when provided', async () => {
            const result = await (releaseCreator as any).getNewVersion('patch', '5.0.0', '/fake/dir');

            expect(result).to.equal('5.0.0');
        });

        it('increments patch version', async () => {
            // Use real package.json which has version 1.0.0
            const result = await (releaseCreator as any).getNewVersion('patch', '', process.cwd());

            expect(result).to.equal('1.0.1');
        });

        it('increments minor version', async () => {
            const result = await (releaseCreator as any).getNewVersion('minor', '', process.cwd());

            expect(result).to.equal('1.1.0');
        });

        it('increments major version', async () => {
            const result = await (releaseCreator as any).getNewVersion('major', '', process.cwd());

            expect(result).to.equal('2.0.0');
        });

        it('increments prerelease version', async () => {
            const result = await (releaseCreator as any).getNewVersion('prerelease', '', process.cwd());

            expect(result).to.equal('1.0.1-0');
        });
    });

    describe('getArtifactName', () => {
        it('returns single artifact when only one exists', () => {
            const result = (releaseCreator as any).getArtifactName(['artifact.tgz'], 'hint.tgz');

            expect(result).to.equal('artifact.tgz');
        });

        it('filters by extension when multiple artifacts', () => {
            const artifacts = ['file.tgz', 'file.vsix', 'other.tgz'];
            const result = (releaseCreator as any).getArtifactName(artifacts, 'hint.vsix');

            expect(result).to.equal('file.vsix');
        });

        it('matches by name hint when multiple with same extension', () => {
            const artifacts = ['foo-1.0.0.tgz', 'bar-1.0.0.tgz'];
            const result = (releaseCreator as any).getArtifactName(artifacts, 'bar-1.0.0.tgz');

            expect(result).to.equal('bar-1.0.0.tgz');
        });

        it('returns first match when multiple matches', () => {
            const artifacts = ['test-1.0.0.tgz', 'test-1.0.0-extra.tgz'];
            const result = (releaseCreator as any).getArtifactName(artifacts, 'test-1.0.0.tgz');

            expect(result).to.equal('test-1.0.0.tgz');
        });

        it('returns name hint as fallback when no match', () => {
            const result = (releaseCreator as any).getArtifactName([], 'fallback.tgz');

            expect(result).to.equal('fallback.tgz');
        });
    });

    describe('appendDateToArtifactName', () => {
        it('inserts branch and date before extension', () => {
            const result = (releaseCreator as any).appendDateToArtifactName('package-1.0.0.tgz', '1.0.0', 'release/1.0.0');

            expect(result).to.match(/^package-1\.0\.0-release_1\.0\.0\.\d{14}\.tgz$/);
        });

        it('replaces first slash in branch name with underscore', () => {
            // Note: Current implementation only replaces first slash
            const result = (releaseCreator as any).appendDateToArtifactName('test.vsix', '1.0.0', 'release/1.0.0');

            expect(result).to.include('release_1.0.0');
        });
    });

    describe('makePullRequestBody', () => {
        it('generates draft PR body with edit changelog link', () => {
            const result = (releaseCreator as any).makePullRequestBody({
                projectName: 'test-project',
                releaseVersion: '1.0.0',
                prevReleaseVersion: '0.9.0',
                isDraft: true
            });

            expect(result).to.include('v1.0.0');
            expect(result).to.include('test-project');
            expect(result).to.include('Edit changelog');
            expect(result).to.include('release/1.0.0');
        });

        it('generates published PR body with release link', () => {
            const result = (releaseCreator as any).makePullRequestBody({
                projectName: 'test-project',
                releaseVersion: '1.0.0',
                prevReleaseVersion: '0.9.0',
                isDraft: false,
                githubReleaseLink: 'https://github.com/test/releases/v1.0.0'
            });

            expect(result).to.include('GitHub Release');
            expect(result).to.include('Changelog');
            expect(result).to.not.include('Edit changelog');
        });

        it('includes npm install command when npm artifact', () => {
            const result = (releaseCreator as any).makePullRequestBody({
                projectName: 'test-project',
                releaseVersion: '1.0.0',
                prevReleaseVersion: '0.9.0',
                isDraft: true,
                npm: {
                    downloadLink: 'https://example.com/package.tgz',
                    sha: 'abc123',
                    command: '```bash\nnpm install https://example.com/package.tgz\n```'
                }
            });

            expect(result).to.include('npm install');
            expect(result).to.include('abc123');
        });

        it('includes vsix download link when vsix artifact', () => {
            const result = (releaseCreator as any).makePullRequestBody({
                projectName: 'test-project',
                releaseVersion: '1.0.0',
                prevReleaseVersion: '0.9.0',
                isDraft: true,
                vsix: {
                    downloadLink: 'https://example.com/extension.vsix',
                    sha: 'def456'
                }
            });

            expect(result).to.include('download the .vsix');
            expect(result).to.include('def456');
            expect(result).to.include('installation instructions');
        });

        it('includes PR number in edit changelog link when provided', () => {
            const result = (releaseCreator as any).makePullRequestBody({
                projectName: 'test-project',
                releaseVersion: '1.0.0',
                prevReleaseVersion: '0.9.0',
                isDraft: true,
                prNumber: 123
            });

            expect(result).to.include('?pr=');
            expect(result).to.include('pull/123');
        });
    });

    describe('initializeRelease', () => {
        it('fails if repository is not clean', async () => {
            const mockProject = createMockProject();
            sinon.stub(ProjectManager, 'initialize').resolves(mockProject);
            sinon.stub(utils, 'executeCommandSucceeds').withArgs('git diff --quiet').returns(false);

            await expect(
                releaseCreator.initializeRelease({
                    projectName: 'test-project',
                    releaseType: 'patch',
                    branch: 'master',
                    installDependencies: false,
                    customVersion: '1.0.0'
                })
            ).to.be.rejectedWith('Repository is not clean');
        });

        it('fails if release already exists', async () => {
            const mockProject = createMockProject();
            sinon.stub(ProjectManager, 'initialize').resolves(mockProject);
            sinon.stub(utils, 'executeCommandSucceeds').returns(true);
            sinon.stub(utils, 'executeCommandWithOutput').returns('');
            sinon.stub((releaseCreator as any).octokit.rest.repos, 'listReleases').resolves({
                data: [createMockRelease({ tag_name: 'v1.0.0' })]
            });

            await expect(
                releaseCreator.initializeRelease({
                    projectName: 'test-project',
                    releaseType: 'patch',
                    branch: 'master',
                    installDependencies: false,
                    customVersion: '1.0.0'
                })
            ).to.be.rejectedWith('Release v1.0.0 already exists');
        });
    });

    describe('publishRelease', () => {
        it('fails if release has no assets', async () => {
            const mockProject = createMockProject();
            sinon.stub(ProjectManager, 'initialize').resolves(mockProject);
            sinon.stub(utils, 'executeCommand');
            sinon.stub(utils, 'executeCommandSucceeds').returns(true);
            sinon.stub(releaseCreator as any, 'getVersion').resolves('1.0.0');

            const mockRelease = createMockRelease({ draft: false }); // Not a draft, so skips updateRelease
            sinon.stub(releaseCreator as any, 'assertSingleRelease').resolves(mockRelease);
            sinon.stub(utils, 'octokitPageHelper').resolves([]);

            await expect(
                releaseCreator.publishRelease({
                    projectName: 'test-project',
                    ref: 'abc123',
                    releaseType: 'npm'
                })
            ).to.be.rejectedWith(/has no assets/);
        });
    });

    describe('makeReleaseArtifacts', () => {
        it('fails if published release has assets without --force', async () => {
            const mockProject = createMockProject();
            sinon.stub(ProjectManager, 'initialize').resolves(mockProject);
            sinon.stub(utils, 'executeCommand');
            sinon.stub(releaseCreator as any, 'getVersion').resolves('1.0.0');
            sinon.stub(fastGlob, 'sync').returns(['artifact.tgz']);

            const mockRelease = createMockRelease({ draft: false });
            sinon.stub(releaseCreator as any, 'assertSingleRelease').resolves(mockRelease);
            sinon.stub(utils, 'octokitPageHelper').resolves([createMockAsset()]);

            await expect(
                releaseCreator.makeReleaseArtifacts({
                    branch: 'release/1.0.0',
                    projectName: 'test-project',
                    artifactPaths: '*.tgz',
                    force: false
                })
            ).to.be.rejectedWith(/already published with assets/);
        });
    });

});
