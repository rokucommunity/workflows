import { execSync } from 'child_process';
import * as semver from 'semver';

export class logger {
    private static instance: logger;
    private indentLevel = 0;
    private indentChar = '.';

    private constructor() { }

    static getInstance() {
        if (!logger.instance) {
            logger.instance = new logger();
        }
        return logger.instance;
    }

    static inLog(...messages: any[]) {
        const logger = this.getInstance();
        logger.indentLevel += 4;
        console.log(`${logger.indentChar.repeat(logger.indentLevel)}`, ...messages);
        logger.indentLevel -= 4;
    }

    static log(...messages: any[]) {
        const logger = this.getInstance();
        console.log(`${logger.indentChar.repeat(logger.indentLevel)}`, ...messages);
    }

    static increaseIndent() {
        this.getInstance().indentLevel += 4;
    }

    static decreaseIndent() {
        this.getInstance().indentLevel -= 4;
    }
}

export class utils {
    static OCTOKIT_PER_PAGE = 100;

    static isVerbose(): boolean {
        return process.env.RUNNER_DEBUG === '1';
    }

    static isVersion(versionOrCommitHash: string) {
        return semver.valid(versionOrCommitHash);
    }

    static executeCommand(command: string, options?: any) {
        options = { ...options, env: process.env };
        if (this.isVerbose()) {
            logger.inLog(`Executing ${command} with ${JSON.stringify(options)}`);
        }
        const response = execSync(command, options);
        if (this.isVerbose()) {
            console.log(response.toString().trim());
        }
    }

    static executeCommandSucceeds(command: string, options?: any) {
        options = { ...options, env: process.env };
        try {
            command = `${command} && echo 1`;
            if (this.isVerbose()) {
                logger.inLog(`Executing ${command} with ${JSON.stringify(options)} and checking for success`);
            }
            let response = execSync(command, options)?.toString().trim();
            if (this.isVerbose()) {
                console.log(response);
            }
            return (response === '1');
        } catch (e) {
            return false;
        }
    }

    static executeCommandWithOutput(command: string, options?: any) {
        options = { ...options, env: process.env };
        if (this.isVerbose()) {
            logger.inLog(`Executing ${command} with ${JSON.stringify(options)}`);
        }
        const response = execSync(command, options).toString().trim();
        if (this.isVerbose()) {
            console.log(response);
        }
        return response;
    }

    static tryExecuteCommandWithOutput(command: string, options?: any) {
        try {
            return this.executeCommandWithOutput(command, options);
        } catch (e) {
            return '';
        }
    }

    static async octokitPageHelper<T>(api: (options: any, page: number) => Promise<{ data: T[] }>, options = {}): Promise<T[]> {
        let getMorePages = true;
        let page = 1;
        let data: T[] = [];

        while (getMorePages) {
            let releasePage = await api(options, page);
            if (!releasePage.data) {
                break;
            }
            if (releasePage.data.length < utils.OCTOKIT_PER_PAGE) {
                getMorePages = false;
            }
            data = data.concat(releasePage.data);
            page++;
        }
        return data;
    }

    static throwError(message: string, options?: any) {
        if (options?.testRun) {
            logger.log(`TEST RUN: By-passing error: ${message}`);
            return;
        }
        throw new Error(message);
    }
}