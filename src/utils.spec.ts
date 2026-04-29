/* eslint-disable camelcase */
import { expect } from 'chai';
import * as chai from 'chai';
import chaiAsPromised from 'chai-as-promised';
import { createSandbox } from 'sinon';
import { utils, standardizePath } from './utils';

chai.use(chaiAsPromised);

const sinon = createSandbox();

describe('utils', () => {
    afterEach(() => {
        sinon.restore();
    });

    describe('isVersion', () => {
        it('returns truthy for valid semver', () => {
            expect(utils.isVersion('1.0.0')).to.be.ok;
            expect(utils.isVersion('1.2.3')).to.be.ok;
            expect(utils.isVersion('0.0.1')).to.be.ok;
            expect(utils.isVersion('1.0.0-alpha.1')).to.be.ok;
            expect(utils.isVersion('2.0.0-beta.0')).to.be.ok;
        });

        it('returns falsy for commit hashes', () => {
            expect(utils.isVersion('abc123')).to.not.be.ok;
            expect(utils.isVersion('a1b2c3d4e5f6')).to.not.be.ok;
        });

        it('returns falsy for invalid strings', () => {
            expect(utils.isVersion('not-a-version')).to.not.be.ok;
            expect(utils.isVersion('')).to.not.be.ok;
        });
    });

    describe('executeCommandSucceeds', () => {
        it('returns true when command succeeds', () => {
            const result = utils.executeCommandSucceeds('echo hello');

            expect(result).to.be.true;
        });

        it('returns false when command fails', () => {
            const result = utils.executeCommandSucceeds('exit 1');

            expect(result).to.be.false;
        });

        it('does not throw on failure', () => {
            expect(() => utils.executeCommandSucceeds('exit 1')).to.not.throw();
        });
    });

    describe('tryExecuteCommandWithOutput', () => {
        it('returns trimmed output on success', () => {
            // Use a real command that we know will succeed
            const result = utils.tryExecuteCommandWithOutput('echo hello');

            expect(result).to.equal('hello');
        });

        it('returns empty string on failure', () => {
            // Use a command that will fail
            const result = utils.tryExecuteCommandWithOutput('exit 1');

            expect(result).to.equal('');
        });
    });

    describe('octokitPageHelper', () => {
        it('collects data from single page', async () => {
            const mockApi = sinon.stub().resolves({ data: [{ id: 1 }, { id: 2 }] });

            const result = await utils.octokitPageHelper(mockApi);

            expect(result).to.deep.equal([{ id: 1 }, { id: 2 }]);
            expect(mockApi.calledOnce).to.be.true;
        });

        it('paginates when data.length equals OCTOKIT_PER_PAGE', async () => {
            const fullPage = Array(utils.OCTOKIT_PER_PAGE).fill({ id: 1 });
            const partialPage = [{ id: 2 }, { id: 3 }];

            const mockApi = sinon.stub();
            mockApi.onFirstCall().resolves({ data: fullPage });
            mockApi.onSecondCall().resolves({ data: partialPage });

            const result = await utils.octokitPageHelper(mockApi);

            expect(result.length).to.equal(utils.OCTOKIT_PER_PAGE + 2);
            expect(mockApi.calledTwice).to.be.true;
        });

        it('stops pagination when data.length < OCTOKIT_PER_PAGE', async () => {
            const mockApi = sinon.stub().resolves({ data: [{ id: 1 }] });

            await utils.octokitPageHelper(mockApi);

            expect(mockApi.calledOnce).to.be.true;
        });

        it('handles empty first page', async () => {
            const mockApi = sinon.stub().resolves({ data: [] });

            const result = await utils.octokitPageHelper(mockApi);

            expect(result).to.deep.equal([]);
            expect(mockApi.calledOnce).to.be.true;
        });

        it('handles missing data property', async () => {
            const mockApi = sinon.stub().resolves({});

            const result = await utils.octokitPageHelper(mockApi);

            expect(result).to.deep.equal([]);
        });
    });

    describe('throwError', () => {
        it('throws error normally', () => {
            expect(() => utils.throwError('test error')).to.throw('test error');
        });

        it('throws error when testRun is false', () => {
            expect(() => utils.throwError('test error', { testRun: false })).to.throw('test error');
        });

        it('does not throw when testRun is true', () => {
            expect(() => utils.throwError('test error', { testRun: true })).to.not.throw();
        });

        it('returns undefined when testRun is true', () => {
            const result = utils.throwError('test error', { testRun: true });
            expect(result).to.be.undefined;
        });
    });

    describe('standardizePath', () => {
        it('normalizes consecutive slashes', () => {
            const result = utils.standardizePath('/path//to///file');
            expect(result).to.equal('/path/to/file');
        });

        it('normalizes backslashes to forward slashes', () => {
            const result = utils.standardizePath('/path\\to\\file');
            expect(result).to.equal('/path/to/file');
        });

        it('resolves relative parts', () => {
            const result = utils.standardizePath('/path/to/../file');
            expect(result).to.equal('/path/file');
        });

        it('caches results', () => {
            const path1 = '/some/unique/path/1';
            const result1 = utils.standardizePath(path1);
            const result2 = utils.standardizePath(path1);
            expect(result1).to.equal(result2);
        });

        it('returns non-string values unchanged', () => {
            const result = utils.standardizePath(null as any);
            expect(result).to.be.null;
        });

        it('lowercases Windows drive letters', () => {
            const result = utils.standardizePath('C:/path/to/file');
            expect(result).to.equal('c:/path/to/file');
        });
    });

    describe('standardizePath tagged template', () => {
        it('works as tagged template literal', () => {
            const dir = 'some/dir';
            const file = 'file.txt';
            const result = standardizePath`${dir}/${file}`;
            expect(result).to.equal('some/dir/file.txt');
        });
    });

    describe('sleep', () => {
        it('resolves after specified milliseconds', async () => {
            const start = Date.now();
            await utils.sleep(50);
            const elapsed = Date.now() - start;
            expect(elapsed).to.be.at.least(40); // Allow some tolerance
        });

        it('is cancellable', () => {
            const promise = utils.sleep(1000);
            promise.cancel();
            // Should not wait 1000ms - this test should complete quickly
        });
    });
});
