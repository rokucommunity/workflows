#!/usr/bin/env node
import * as yargs from 'yargs';
import * as dotenv from 'dotenv';
import { ReleaseCreator } from './ReleaseCreator';
import { run as AuditOpenReleases } from './AuditOpenReleases';
import { logger } from './utils';

export const options = yargs
    .command('initialize-release', 'Initialize a release PR, draft GitHub release', (builder) => {
        return builder
            .option('projectName', { type: 'string', description: 'The name of the project to create the release for' })
            .option('branch', { type: 'string', description: 'The branch to create the release from' })
            .option('releaseType', { type: 'string', description: 'The version number to use for creating the release' })
            .option('installDependencies', { type: 'boolean', description: 'Install dependencies before running the release' })
            .option('customVersion', { type: 'string', description: 'User specified release version. May include prerelease ids', default: '' })
            .option('githubToken', { type: 'string', description: 'Specify the github token for use throughout this process' })
            .options('testRun', { type: 'boolean', description: 'Run the release in test mode' });
    }, (argv) => {
        if (!['major', 'minor', 'patch', 'prerelease'].includes(argv.releaseType)) {
            console.error(`Invalid release version. Must be one of 'major', 'minor', or 'patch'`);
            process.exit(1);
        }
        argv = preSetup(argv);
        new ReleaseCreator().initializeRelease(argv as any).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('make-release-artifacts', 'Upload release artifacts to GitHub release', (builder) => {
        return builder
            .option('branch', { type: 'string', description: 'The release branch to checkout' })
            .option('projectName', { type: 'string', description: 'The name of the project to create the release for' })
            .option('artifactPaths', { type: 'string', description: 'The glob pattern used to get release artifact(s)' })
            .option('githubToken', { type: 'string', description: 'Specify the github token for use throughout this process' })
            .option('force', { type: 'boolean', description: 'Always upload artifacts to GitHub release' });
    }, (argv) => {
        argv = preSetup(argv);
        new ReleaseCreator().makeReleaseArtifacts(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('publish-release', 'Publish GitHub release, push artifacts for public use', (builder) => {
        return builder
            .option('projectName', { type: 'string', description: 'The name of the project to create the release for' })
            .option('ref', { type: 'string', description: 'The merge commit for the pull request' })
            .option('githubToken', { type: 'string', description: 'Specify the github token for use throughout this process' })
            .option('releaseType', { type: 'string', description: 'The store we are releasing to' });
    }, (argv) => {
        argv = preSetup(argv);
        new ReleaseCreator().publishRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('close-release', 'Close GitHub release, PR, and branch', (builder) => {
        return builder
            .option('projectName', { type: 'string', description: 'The name of the project to create the release for' })
            .option('githubToken', { type: 'string', description: 'Specify the github token for use throughout this process' });
    }, (argv) => {
        argv = preSetup(argv);
        new ReleaseCreator().closeRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('delete-release', 'Delete GitHub release, close pull request, and delete branch', (builder) => {
        return builder
            .option('projectName', { type: 'string', description: 'The name of the project to create the release for' })
            .option('releaseVersion', { type: 'string', description: 'The version the release is based on' })
            .option('githubToken', { type: 'string', description: 'Specify the github token for use throughout this process' });
    }, (argv) => {
        argv = preSetup(argv);
        new ReleaseCreator().deleteRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('audit-open-releases', 'Check a whitelist of repos for stale release pull requests', (builder) => {
        return builder;
    }, (argv) => {
        dotenv.config();
        AuditOpenReleases().catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .argv;


function preSetup(argv: any) {
    dotenv.config();

    //support overriding the github token via cli option (this takes presedence over the environment variable)
    if (typeof argv.githubToken === 'string' && argv.githubToken?.length > 0) {
        process.env.GH_TOKEN = argv.githubToken;
    }

    logger.log('Environment Variables:');
    logger.inLog(`RUNNER_DEBUG: ${process.env.RUNNER_DEBUG}`);

    if ('projectName' in argv) {
        if (argv.projectName.includes('/')) {
            argv.projectName = argv.projectName.split('/')[1];
        }
    }
    return argv;
}
