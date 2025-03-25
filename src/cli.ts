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
            .option('branch', { type: 'string', description: 'The branch to create the release from' })
            .option('releaseType', { type: 'string', description: 'The version number to use for creating the release' })
            .option('installDependencies', { type: 'boolean', description: 'Install dependencies before running the release' })
    }, (argv) => {
        if (!['major', 'minor', 'patch'].includes(argv.releaseType)) {
            console.error(`Invalid release version. Must be one of 'major', 'minor', or 'patch'`);
            process.exit(1);
        }
        printEnvValues();
        new ReleaseCreator().initializeRelease({ branch: argv.branch, releaseType: argv.releaseType, installDependencies: argv.installDependencies }).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('upload-release', 'Upload release artifacts to GitHub release', (builder) => {
        return builder
            .option('branch', { type: 'string', description: 'The branch the release is based on' })
            .option('artifactPaths', { type: 'string', description: 'The glob pattern used to get release artifact(s)' })
    }, (argv) => {
        printEnvValues();
        new ReleaseCreator().uploadRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('publish-release', 'Publish GitHub release, push artifacts for public use', (builder) => {
        return builder
            .option('branch', { type: 'string', description: 'The branch the release is based on' })
            .option('releaseType', { type: 'string', description: 'The store we are releasing to' })
    }, (argv) => {
        printEnvValues();
        new ReleaseCreator().publishRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .command('delete-release', 'Delete GitHub release, close pull request, and delete branch', (builder) => {
        return builder
            .option('releaseVersion', { type: 'string', description: 'The version the release is based on' })
    }, (argv) => {
        printEnvValues();
        new ReleaseCreator().deleteRelease(argv).catch(e => {
            console.error(e);
            process.exit(1);
        });
    })
    .argv;


function printEnvValues() {
    logger.log('Environment Variables:');
    logger.inLog(`RUNNER_DEBUG: ${process.env.RUNNER_DEBUG}`);
}