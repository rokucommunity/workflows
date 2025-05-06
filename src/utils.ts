import { execSync } from 'child_process';
import * as semver from 'semver';
import * as path from 'path';

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
            if (this.isVerbose()) {
                logger.inLog(`Executing ${command} with ${JSON.stringify(options)} and checking for success`);
            }
            let response = execSync(command, options)?.toString().trim();
            if (this.isVerbose()) {
                console.log(response);
            }
            return true;
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

    private static isWindows = process.platform === 'win32';
    private static standardizePathCache = new Map<string, string>();

    /**
     * Converts a path into a standardized format (drive letter to lower, remove extra slashes, use single slash type, resolve relative parts, etc...)
     */
    public static standardizePath(thePath: string): string {
        //if we have the value in cache already, return it
        if (this.standardizePathCache.has(thePath)) {
            return this.standardizePathCache.get(thePath);
        }
        const originalPath = thePath;

        if (typeof thePath !== 'string') {
            return thePath;
        }

        //windows path.normalize will convert all slashes to backslashes and remove duplicates
        if (this.isWindows) {
            thePath = path.win32.normalize(thePath);
        } else {
            //replace all windows or consecutive slashes with path.sep
            thePath = thePath.replace(/[\/\\]+/g, '/');

            // only use path.normalize if dots are present since it's expensive
            if (thePath.includes('./')) {
                thePath = path.posix.normalize(thePath);
            }
        }

        // Lowercase drive letter on Windows-like paths (e.g., "C:/...")
        if (thePath.charCodeAt(1) === 58 /* : */) {
            // eslint-disable-next-line no-var
            var firstChar = thePath.charCodeAt(0);
            if (firstChar >= 65 && firstChar <= 90) {
                thePath = String.fromCharCode(firstChar + 32) + thePath.slice(1);
            }
        }
        this.standardizePathCache.set(originalPath, thePath);
        return thePath;
    }

    public static sleep(milliseconds: number) {
        let handle: NodeJS.Timeout;
        const promise = new Promise((resolve) => {
            handle = setTimeout(resolve, milliseconds);
        }) as Promise<void> & { cancel: () => void };
        promise.cancel = () => {
            clearTimeout(handle);
        };
        return promise;
    }
}

/**
 * A tagged template literal function for standardizing the path. This has to be defined as standalone function since it's a tagged template literal function,
 * we can't use `object.tag` syntax.
 */
export function standardizePath(stringParts, ...expressions: any[]) {
    let result: string[] = [];
    for (let i = 0; i < stringParts.length; i++) {
        result.push(stringParts[i], expressions[i]);
    }
    return utils.standardizePath(
        result.join('')
    );
}
