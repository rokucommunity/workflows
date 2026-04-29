import { Project, ProjectDependency } from './ProjectManager';

/**
 * Creates a mock Project with sensible defaults.
 * Override any property by passing it in the overrides object.
 */
export function createMockProject(overrides: Partial<Project> = {}): Project {
    const project = new Project(
        overrides.name ?? 'test-project',
        overrides.npmName ?? '@rokucommunity/test-project',
        overrides.repositoryUrl ?? 'https://github.com/rokucommunity/test-project'
    );
    project.dir = overrides.dir ?? '/tmp/.releases/test-project';
    project.version = overrides.version ?? '1.0.0';
    project.dependencies = overrides.dependencies ?? [];
    project.devDependencies = overrides.devDependencies ?? [];
    project.changes = overrides.changes ?? [];
    project.lastTag = overrides.lastTag ?? 'v0.9.0';
    return project;
}

/**
 * Creates a mock GitHub Release object.
 */
export function createMockRelease(overrides: Partial<MockRelease> = {}): MockRelease {
    return {
        id: overrides.id ?? 1,
        tag_name: overrides.tag_name ?? 'v1.0.0',
        name: overrides.name ?? '1.0.0',
        draft: overrides.draft ?? true,
        prerelease: overrides.prerelease ?? false,
        html_url: overrides.html_url ?? 'https://github.com/rokucommunity/test-project/releases/tag/v1.0.0',
        assets: overrides.assets ?? [],
        target_commitish: overrides.target_commitish ?? 'release/1.0.0',
        body: overrides.body ?? 'Release notes'
    };
}

export interface MockRelease {
    id: number;
    tag_name: string;
    name: string;
    draft: boolean;
    prerelease: boolean;
    html_url: string;
    assets: MockAsset[];
    target_commitish: string;
    body: string;
}

/**
 * Creates a mock GitHub Release Asset object.
 */
export function createMockAsset(overrides: Partial<MockAsset> = {}): MockAsset {
    return {
        id: overrides.id ?? 1,
        name: overrides.name ?? 'test-project-1.0.0.tgz',
        size: overrides.size ?? 1024,
        download_count: overrides.download_count ?? 0,
        browser_download_url: overrides.browser_download_url ?? 'https://github.com/rokucommunity/test-project/releases/download/v1.0.0/test-project-1.0.0.tgz'
    };
}

export interface MockAsset {
    id: number;
    name: string;
    size: number;
    download_count: number;
    browser_download_url: string;
}

/**
 * Creates a mock Pull Request object.
 */
export function createMockPullRequest(overrides: Partial<MockPullRequest> = {}): MockPullRequest {
    return {
        number: overrides.number ?? 123,
        title: overrides.title ?? '1.0.0',
        state: overrides.state ?? 'open',
        html_url: overrides.html_url ?? 'https://github.com/rokucommunity/test-project/pull/123',
        head: overrides.head ?? { ref: 'release/1.0.0' },
        base: overrides.base ?? { ref: 'master' },
        body: overrides.body ?? 'PR body'
    };
}

export interface MockPullRequest {
    number: number;
    title: string;
    state: string;
    html_url: string;
    head: { ref: string };
    base: { ref: string };
    body: string;
}

/**
 * Helper to create an Octokit-style response wrapper.
 */
export function createOctokitResponse<T>(data: T, status = 200) {
    return {
        data,
        status,
        headers: {}
    };
}
