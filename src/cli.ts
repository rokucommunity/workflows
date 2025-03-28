#!/usr/bin/env node
import * as yargs from 'yargs';
import * as path from 'path';
import { execSync } from 'child_process';
import { ReleaseCreator } from './ReleaseCreator';
import { ChangelogGenerator } from './ChangeLogGenerator';
import { logger } from './utils';

let options = yargs
    .command('initialize-release', 'Initialize a release PR, draft GitHub release', (builder) => {
        return builder
            .option('projectName', { type: 'string', description: 'The name of the project to create the release for' })
            .option('branch', { type: 'string', description: 'The branch to create the release from' })
            .option('releaseType', { type: 'string', description: 'The version number to use for creating the release' })
            .option('installDependencies', { type: 'boolean', description: 'Install dependencies before running the release' })
            .options('testRun', { type: 'boolean', description: 'Run the release in test mode' })
    }, (argv) => {
        if (!['major', 'minor', 'patch'].includes(argv.releaseType)) {
            console.error(`Invalid release version. Must be one of 'major', 'minor', or 'patch'`);
            process.exit(1);
        }
        argv = preSetup(argv);
        new ReleaseCreator().initializeRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('upload-release', 'Upload release artifacts to GitHub release', (builder) => {
        return builder
            .option('projectName', { type: 'string', description: 'The name of the project to create the release for' })
            .option('artifactPaths', { type: 'string', description: 'The glob pattern used to get release artifact(s)' })
    }, (argv) => {
        argv = preSetup(argv);
        new ReleaseCreator().uploadRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('publish-release', 'Publish GitHub release, push artifacts for public use', (builder) => {
        return builder
            .option('projectName', { type: 'string', description: 'The name of the project to create the release for' })
            .option('ref', { type: 'string', description: 'The merge commit for the pull request' })
            .option('releaseType', { type: 'string', description: 'The store we are releasing to' })
    }, (argv) => {
        argv = preSetup(argv);
        new ReleaseCreator().publishRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('delete-release', 'Delete GitHub release, close pull request, and delete branch', (builder) => {
        return builder
            .option('projectName', { type: 'string', description: 'The name of the project to create the release for' })
            .option('releaseVersion', { type: 'string', description: 'The version the release is based on' })
    }, (argv) => {
        argv = preSetup(argv);
        new ReleaseCreator().deleteRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .argv;


function preSetup(argv: any) {
    logger.log('Environment Variables:');
    logger.inLog(`RUNNER_DEBUG: ${process.env.RUNNER_DEBUG}`);

    if ('projectName' in argv) {
        if (argv.projectName.includes('/')) {
            argv.projectName = argv.projectName.split('/')[1];
        }
    }
    return argv;
}