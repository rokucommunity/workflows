/* eslint-disable camelcase */
import { expect } from 'chai';
import { createSandbox } from 'sinon';
import { ReleaseCreator } from './ReleaseCreator';
import { utils } from './utils';

const sinon = createSandbox();
let releaseCreator: ReleaseCreator;

describe('Test ReleaseCreator.ts', () => {
    beforeEach(() => {
        sinon.restore();
        releaseCreator = new ReleaseCreator();
    });

    afterEach(() => {
        sinon.restore();
    });

    it('Successfully gets the previous release version', () => {
        let tags = [
            'v1.0.0',
            'v0.9.0',
            'v0.8.0'
        ];
        sinon.stub(utils, 'executeCommandWithOutput').callsFake((cmd: string, dir: string) => {
            if (cmd === `git tag --merged HEAD`) {
                return tags.join('\n');
            } else {
                return utils.executeCommandWithOutput(cmd, dir);
            }
        });
        expect(releaseCreator['getPreviousVersion']('1.0.1', '')).to.equal('1.0.0');
        expect(releaseCreator['getPreviousVersion']('0.9.1', '')).to.equal('0.9.0');
        expect(releaseCreator['getPreviousVersion']('0.8.9', '')).to.equal('0.8.0');
        expect(releaseCreator['getPreviousVersion']('0.1.0', '')).to.equal(undefined);
    });

    it('Successfully gets the previous release version with prerelease', () => {
        sinon.stub(utils, 'executeCommandWithOutput').callsFake((cmd: string, dir: string) => {
            if (cmd === `git tag --merged HEAD`) {
                return tags.join('\n');
            } else {
                return utils.executeCommandWithOutput(cmd, dir);
            }
        });
        let tags = [
            'v0.9.9',
            'v0.9.0',
            'v0.8.0'
        ];
        expect(releaseCreator['getPreviousVersion']('1.0.0-alpha.0', '')).to.equal('0.9.9');
        tags = [
            'v1.0.0-alpha.0',
            'v1.0.0',
            'v0.9.0',
            'v0.8.0'
        ];
        expect(releaseCreator['getPreviousVersion']('1.0.0-alpha.1', '')).to.equal('1.0.0-alpha.0');
        tags = [
            'v0.9.2',
            'v0.9.1',
            'v0.9.0',
            'v1.0.0-alpha.0',
            'v0.9.0',
            'v0.8.0'
        ];
        expect(releaseCreator['getPreviousVersion']('1.0.0-alpha.1', '')).to.equal('1.0.0-alpha.0');
    });
});
