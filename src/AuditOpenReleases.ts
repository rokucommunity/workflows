import { logger, utils, standardizePath as s } from './utils';
import * as fsExtra from 'fs-extra';
import { Octokit } from '@octokit/rest';
import { find } from 'find-in-files';
import fetch from 'node-fetch';
import diffParse from 'parse-diff';
import { DateTime } from 'luxon';


const tempDir = s`${__dirname}/../.tmp/.releases`;

export async function run() {
    await auditChangeLogDate();
}

async function auditChangeLogDate() {

    logger.log('Running Audit Open Releases...');
    logger.increaseIndent();

    emptyTempDir();

    const octokit = new Octokit({
        auth: process.env.GH_TOKEN,
        request: { fetch }
    });
    const ORG = 'rokucommunity';
    async function getReleasePullRequests(repoName: string) {
        const pullRequests = await octokit.rest.pulls.list({
            owner: ORG,
            repo: repoName,
            state: 'open'
        });
        return pullRequests.data.filter(pr => pr.head.ref.startsWith(`release/`));
    }

    const today = DateTime.now().setZone('America/New_York').toISODate();

    for (const repo of repositories) {
        const releases = await getReleasePullRequests('release-testing');
        logger.log(`Found ${releases.length} open release pull requests in ${repo}`);
        logger.increaseIndent();
        for (const release of releases) {
            const releaseNumber = release.head.ref.split('/')[1];
            logger.log(`Get the changelog file patch from the pull request`);
            const { data: files } = await octokit.rest.pulls.listFiles({
                owner: ORG,
                repo: repo,
                pull_number: release.number
            });

            const changelogFile = files.find(f => f.filename === 'CHANGELOG.md');
            if (!changelogFile) {
                return;
            }

            const parsedPatch = diffParse(changelogFile.patch);
            const chunks = parsedPatch?.at(0)?.chunks;
            // eslint-disable-next-line no-inner-declarations
            function findReleaseDateLineInChunk(chunks) {
                for (const chunk of chunks) {
                    for (const change of chunk.changes) {
                        const match = /\+## \[.*?\]\(.*?\) - (\d{4}-\d{2}-\d{2})/.exec(change.content);
                        if (match) {
                            return { content: change.content, date: match[1] };
                        }
                    }
                }
            }
            if (!chunks) {
                return;
            }
            let lineData = findReleaseDateLineInChunk(chunks);
            if (!lineData) {
                return;
            }
            let releaseData = DateTime.fromISO(lineData.date, { zone: 'America/New_York' }).toISODate();
            if (releaseData >= today) {
                logger.log(`Release ${releaseNumber} is up to date`);
                continue;
            }
            logger.log(`Release ${releaseNumber} is stale`);
            const newDateLine = lineData.content.replace(/(\d{4}-\d{2}-\d{2})/, today).slice(1);

            logger.log(`Cloning repository ${repo}`);
            const projectDir = cloneProject(repo);
            utils.executeCommandWithOutput(`git checkout -b release/${releaseNumber}`, { cwd: projectDir });
            utils.executeCommandWithOutput(`git pull --rebase origin release/${releaseNumber}`, { cwd: projectDir });

            logger.log(`Reading the CHANGELOG.md file from the repository`);
            const changelogDir = s`${projectDir}/CHANGELOG.md`;
            let content = fsExtra.readFileSync(changelogDir, 'utf8');

            logger.log(`Updating the changelog file with the new date line`);
            content = content.replace(lineData.content.slice(1), newDateLine);

            logger.log(`Writing the updated changelog back to disk`);
            fsExtra.writeFileSync(changelogDir, content, 'utf8');

            logger.log(`Committing and pushing the updated CHANGELOG.md file`);
            utils.executeCommandWithOutput(`git add CHANGELOG.md`, { cwd: projectDir });
            utils.executeCommandWithOutput(`git commit -m 'Update CHANGELOG.md'`, { cwd: projectDir });
            utils.executeCommand(`git push origin release/${releaseNumber}`, { cwd: projectDir });

            logger.log(`Adding a comment to the pull request`);
            await octokit.rest.issues.createComment({
                owner: ORG,
                repo: repo,
                issue_number: release.number,
                body: `The date for this CHANGELOG has been updated to ${today}.`
            });
        }
        logger.decreaseIndent();
    }
}

function emptyTempDir() {
    logger.log('Creating tempDir', tempDir);
    fsExtra.emptyDirSync(tempDir);
}

function cloneProject(projectName: string) {
    const repoName = projectName.split('/').pop();
    const url = `https://github.com/rokucommunity/${repoName}`;

    logger.log(`Cloning ${url}`);
    let projectDir = s`${tempDir}/${repoName}`;

    utils.executeCommand(`git clone --no-single-branch "${url}" "${projectDir}"`);
    return projectDir;
}


const repositories = [
    'brighterscript',
    'brighterscript-formatter',
    'brs',
    'bsc-plugin-auto-findnode',
    'bsc-plugin-inline-annotation',
    'bslib',
    'bslint',
    'logger',
    'promises',
    'roku-animated-poster',
    'roku-debug',
    'roku-deploy',
    'roku-image-fader',
    'roku-promise',
    'roku-report-analyzer',
    'roku-requests',
    'roku-smart-label',
    'rooibos',
    'ropm',
    'vscode-brightscript-language'
];
