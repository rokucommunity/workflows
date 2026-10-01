/* eslint-disable camelcase */
import { expect } from 'chai';
import { createSandbox } from 'sinon';
import * as fsExtra from 'fs-extra';
import { tmpdir } from 'os';
import { utils, standardizePath as s } from './utils';
import { ChangelogGenerator } from './ChangeLogGenerator';
import { ProjectManager, Project, ProjectDependency } from './ProjectManager';

const sinon = createSandbox();
const changelogGenerator = new ChangelogGenerator();

describe('Test ReleaseCreator.ts', () => {
    beforeEach(() => {
        sinon.restore();
    });

    afterEach(() => {
        sinon.restore();
    });

    it('Successfully creates change logs', () => {
        const changes = [
            'fixed a bug',
            'added a feature',
            'chore: updated dependencies',
            'updated documentation',
            'fixed linting issues',
            'refactored code',
            'improved performance',
            'added tests',
            'updated build process'
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake((projectName: string, startVersion: string, endVersion: string) => {
            return changes.map((change) => {
                return {
                    hash: '',
                    branchInfo: '',
                    message: change,
                    prNumber: ''
                };
            });
        });
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            return {
                name: '',
                npmName: '',
                repositoryUrl: '',
                dir: '',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: changes.map((change) => {
                    return { message: change, hash: '', branchInfo: '', prNumber: '' };
                }),
                lastTag: ''
            };
        });
        const lines = changelog['getChangeLogs'](new Project('test', '', ''), '1.0.0');
        expect(lines[4]).to.contain('## [1.0.0]');
        expect(lines[5]).to.contain('### Added');
        expect(lines[6]).to.contain('added a feature');
        expect(lines[7]).to.contain('added tests');
        expect(lines[8]).to.contain('### Changed');
        expect(lines[9]).to.contain('updated documentation');
        expect(lines[10]).to.contain('refactored code');
        expect(lines[11]).to.contain('improved performance');
        expect(lines[12]).to.contain('updated build process');
        expect(lines[13]).to.contain('### Fixed');
        expect(lines[14]).to.contain('fixed a bug');
        expect(lines[15]).to.contain('fixed linting issues');

    });

    it('Successfully creates change logs with updated dependencies', () => {
        const changes = [
            'fixed a bug',
            'added a feature',
            'chore: updated dependencies',
            'updated documentation',
            'fixed linting issues',
            'refactored code',
            'improved performance',
            'added tests',
            'updated build process'
        ];
        const depChanges = [
            'fixed dep change',
            'added feature in dep'
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake((projectName: string, startVersion: string, endVersion: string) => {
            if (projectName === 'testDep') {
                return depChanges.map((change) => {
                    return {
                        hash: '',
                        branchInfo: '',
                        message: change,
                        prNumber: ''
                    };
                });
            } else {
                return changes.map((change) => {
                    return {
                        hash: '',
                        branchInfo: '',
                        message: change,
                        prNumber: ''
                    };
                });
            }
        });
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            if (name === 'testDep') {
                return {
                    name: '',
                    npmName: '',
                    repositoryUrl: '',
                    dir: '',
                    version: '',
                    dependencies: [],
                    devDependencies: [],
                    changes: depChanges.map((change) => {
                        return { message: change, hash: '', branchInfo: '', prNumber: '' };
                    }),
                    lastTag: ''
                };
            } else {
                return {
                    name: '',
                    npmName: '',
                    repositoryUrl: '',
                    dir: '',
                    version: '',
                    dependencies: [new ProjectDependency(
                        'testDep',
                        'testDep',
                        '1.0.0',
                        '1.0.1',
                        ''
                    )],
                    devDependencies: [],
                    changes: changes.map((change) => {
                        return { message: change, hash: '', branchInfo: '', prNumber: '' };
                    }),
                    lastTag: ''
                };
            }
        });
        sinon.stub(changelog as any, 'getVersionDate').returns('2026-09-02');
        sinon.stub(changelog as any, 'readDependencyChangelog').returns('');
        const project = new Project('test', '', '');
        project.dependencies = [new ProjectDependency('testDep', 'testDep', '1.0.0', '1.0.1', '')];
        const lines = changelog['getChangeLogs'](project, '1.0.0');
        expect(lines[4]).to.contain('## [1.0.0]');
        expect(lines[5]).to.contain('### Added');
        expect(lines[6]).to.contain('added a feature');
        expect(lines[7]).to.contain('added tests');
        expect(lines[8]).to.contain('### Changed');
        expect(lines[9]).to.contain('updated documentation');
        expect(lines[10]).to.contain('refactored code');
        expect(lines[11]).to.contain('improved performance');
        expect(lines[12]).to.contain('updated build process');
        expect(lines[13]).to.contain('- upgrade to [testDep@1.0.1]');
        expect(lines[14]).to.contain('- fixed dep change');
        expect(lines[15]).to.contain('- added feature in dep');
        expect(lines[16]).to.contain('### Fixed');
        expect(lines[17]).to.contain('fixed a bug');
        expect(lines[18]).to.contain('fixed linting issues');
    });

    it('combines commits that have the exact same message', () => {
        const commits = [
            { message: 'Security enhancements', prNumber: '198' },
            { message: 'fix: restrict CreateObject component usage detection', prNumber: '197' },
            { message: 'Security enhancements', prNumber: '196' }
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake(() => {
            return commits.map(x => ({ hash: '', branchInfo: '', message: x.message, prNumber: x.prNumber }));
        });
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            return {
                name: 'bslint',
                npmName: '',
                repositoryUrl: 'https://github.com/rokucommunity/bslint',
                dir: '',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: [],
                lastTag: ''
            };
        });
        const lines = changelog['getChangeLogs'](new Project('bslint', '', 'https://github.com/rokucommunity/bslint'), '1.0.0');
        expect(lines.slice(5)).to.eql([
            '### Changed',
            ' - Security enhancements ([#196](https://github.com/rokucommunity/bslint/pull/196), [#198](https://github.com/rokucommunity/bslint/pull/198))',
            '### Fixed',
            ' - fix: restrict CreateObject component usage detection ([#197](https://github.com/rokucommunity/bslint/pull/197))'
        ]);
    });

    it('combines duplicate dependency commit messages', () => {
        const depCommits = [
            { message: 'Security enhancements', prNumber: '1766' },
            { message: 'Security enhancements', prNumber: '1764' },
            { message: 'chore: Security enhancements', prNumber: '1762' },
            { message: 'added a dep feature', prNumber: '1763' }
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake((projectName: string) => {
            if (projectName === 'brighterscript') {
                return depCommits.map(x => ({ hash: '', branchInfo: '', message: x.message, prNumber: x.prNumber }));
            }
            return [];
        });
        sinon.stub(changelog as any, 'getVersionDate').returns('2026-09-02');
        sinon.stub(changelog as any, 'readDependencyChangelog').returns('');
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            return {
                name: name,
                npmName: '',
                repositoryUrl: `https://github.com/rokucommunity/${name}`,
                dir: '',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: [],
                lastTag: ''
            };
        });
        const project = new Project('bslint', '', 'https://github.com/rokucommunity/bslint');
        project.dependencies = [new ProjectDependency(
            'brighterscript',
            'brighterscript',
            '0.72.5',
            '0.73.1',
            'https://github.com/rokucommunity/brighterscript'
        )];
        const lines = changelog['getChangeLogs'](project, '1.0.0');
        expect(lines.slice(6)).to.eql([
            ' - upgrade to [brighterscript@0.73.1](https://github.com/rokucommunity/brighterscript/blob/v0.73.1/CHANGELOG.md#0731---2026-09-02). Notable changes since 0.72.5:',
            '     - Security enhancements ([#1762](https://github.com/rokucommunity/brighterscript/pull/1762), [#1764](https://github.com/rokucommunity/brighterscript/pull/1764), [#1766](https://github.com/rokucommunity/brighterscript/pull/1766))',
            '     - added a dep feature ([#1763](https://github.com/rokucommunity/brighterscript/pull/1763))'
        ]);
    });

    it('merges dependabot bump commits into the security enhancements entry', () => {
        const commits = [
            { message: 'Bump qs from 6.14.2 to 6.15.3', prNumber: '1766' },
            { message: 'Security enhancements', prNumber: '198' },
            { message: 'Bump postcss from 8.5.10 to 8.5.25', prNumber: '1764' },
            { message: 'security enhancements', prNumber: '196' },
            { message: 'Bump form-data from 2.5.5 to 2.5.6', prNumber: '1733' },
            { message: 'Bump the version of the docs site', prNumber: '150' }
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake(() => {
            return commits.map(x => ({ hash: '', branchInfo: '', message: x.message, prNumber: x.prNumber }));
        });
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            return {
                name: 'bslint',
                npmName: '',
                repositoryUrl: 'https://github.com/rokucommunity/bslint',
                dir: '',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: [],
                lastTag: ''
            };
        });
        const lines = changelog['getChangeLogs'](new Project('bslint', '', 'https://github.com/rokucommunity/bslint'), '1.0.0');
        expect(lines.slice(5)).to.eql([
            '### Changed',
            ' - Security enhancements ([#196](https://github.com/rokucommunity/bslint/pull/196), [#198](https://github.com/rokucommunity/bslint/pull/198), [#1733](https://github.com/rokucommunity/bslint/pull/1733), [#1764](https://github.com/rokucommunity/bslint/pull/1764), [#1766](https://github.com/rokucommunity/bslint/pull/1766))',
            //this one isn't a `bump <pkg> from <version> to <version>` message, so it stays on its own
            ' - Bump the version of the docs site ([#150](https://github.com/rokucommunity/bslint/pull/150))'
        ]);
    });

    it('combines chore-prefixed and path-scoped security commits', () => {
        const commits = [
            { message: 'Security enhancements', prNumber: '414' },
            { message: 'chore: Security enhancements', prNumber: '407' },
            { message: 'Bump brace-expansion in /benchmarks', prNumber: '1774' },
            { message: 'chore(deps): Security enhancements', prNumber: '387' },
            { message: 'Bump qs from 6.14.2 to 6.15.3', prNumber: '1766' },
            { message: 'chore: Simplify create-vsix inputs', prNumber: '401' }
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake(() => {
            return commits.map(x => ({ hash: '', branchInfo: '', message: x.message, prNumber: x.prNumber }));
        });
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            return {
                name: 'bslint',
                npmName: '',
                repositoryUrl: 'https://github.com/rokucommunity/bslint',
                dir: '',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: [],
                lastTag: ''
            };
        });
        const lines = changelog['getChangeLogs'](new Project('bslint', '', 'https://github.com/rokucommunity/bslint'), '1.0.0');
        expect(lines.slice(5)).to.eql([
            '### Changed',
            ' - Security enhancements ([#387](https://github.com/rokucommunity/bslint/pull/387), [#407](https://github.com/rokucommunity/bslint/pull/407), [#414](https://github.com/rokucommunity/bslint/pull/414), [#1766](https://github.com/rokucommunity/bslint/pull/1766), [#1774](https://github.com/rokucommunity/bslint/pull/1774))'
            //`chore: Simplify create-vsix inputs` is still a plain chore, so it stays filtered out of the changelog
        ]);
    });

    it('folds a multi-path bump only when the package is a real dependency of one of those paths', () => {
        const commits = [
            { message: 'Security enhancements', prNumber: '100' },
            //brace-expansion IS declared in /benchmarks, so this is a real dependabot bump
            { message: 'Bump brace-expansion in /benchmarks and /docs', prNumber: '201' },
            //local_var is not declared anywhere, so this is ordinary prose that happens to share the shape
            { message: 'Bump local_var in /SomeURLRoute and /SomeOtherUrlRoute', prNumber: '202' }
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake(() => {
            return commits.map(x => ({ hash: '', branchInfo: '', message: x.message, prNumber: x.prNumber }));
        });
        sinon.stub(changelog as any, 'getDeclaredDependencies').callsFake((dir: string, ref: string, path: string) => {
            return path === '/benchmarks' ? new Set(['brace-expansion']) : new Set<string>();
        });
        sinon.stub(ProjectManager, 'getProject').callsFake(() => {
            return {
                name: 'bslint',
                npmName: '',
                repositoryUrl: 'https://github.com/rokucommunity/bslint',
                dir: '/tmp/bslint',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: [],
                lastTag: ''
            };
        });
        const project = new Project('bslint', '', 'https://github.com/rokucommunity/bslint');
        project.dir = '/tmp/bslint';
        const lines = changelog['getChangeLogs'](project, '1.0.0');
        expect(lines.slice(5)).to.eql([
            '### Changed',
            ' - Security enhancements ([#100](https://github.com/rokucommunity/bslint/pull/100), [#201](https://github.com/rokucommunity/bslint/pull/201))',
            ' - Bump local_var in /SomeURLRoute and /SomeOtherUrlRoute ([#202](https://github.com/rokucommunity/bslint/pull/202))'
        ]);
    });

    it('does not fold a multi-path bump when there is no repo to inspect', () => {
        const changelog = new ChangelogGenerator();
        //no dir means no manifest to verify against, so leave the message alone rather than guessing
        expect(changelog['normalizeCommitMessage']('Bump brace-expansion in /benchmarks and /docs', undefined))
            .to.eql('Bump brace-expansion in /benchmarks and /docs');
    });

    it('reads declared dependencies from a manifest at a git ref', () => {
        const changelog = new ChangelogGenerator();
        const tempDir = s`${tmpdir()}/changelog-manifest-test-${process.pid}`;
        fsExtra.removeSync(tempDir);
        fsExtra.outputJsonSync(s`${tempDir}/benchmarks/package.json`, {
            dependencies: { 'brace-expansion': '^1.1.13' },
            devDependencies: { mocha: '^11.1.0' }
        });
        utils.executeCommand('git init', { cwd: tempDir });
        utils.executeCommand('git add -A', { cwd: tempDir });
        utils.executeCommand('git -c user.name=t -c user.email=t@t commit -m init', { cwd: tempDir });
        try {
            const names = changelog['getDeclaredDependencies'](tempDir, 'HEAD', '/benchmarks');
            expect([...names].sort()).to.eql(['brace-expansion', 'mocha']);
            //a manifest that doesn't exist at this ref yields nothing rather than throwing
            expect([...changelog['getDeclaredDependencies'](tempDir, 'HEAD', '/nope')]).to.eql([]);
        } finally {
            fsExtra.removeSync(tempDir);
        }
    });

    it('combines commits without pr numbers using commit hashes', () => {
        const commits = [
            { hash: 'aaa1111', message: 'Security enhancements' },
            { hash: 'bbb2222', message: 'Security enhancements' }
        ];
        const changelog = new ChangelogGenerator();
        sinon.stub(changelog as any, 'getCommitLogs').callsFake(() => {
            return commits.map(x => ({ hash: x.hash, branchInfo: '', message: x.message, prNumber: undefined }));
        });
        sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => {
            return {
                name: 'bslint',
                npmName: '',
                repositoryUrl: 'https://github.com/rokucommunity/bslint',
                dir: '',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: [],
                lastTag: ''
            };
        });
        const lines = changelog['getChangeLogs'](new Project('bslint', '', 'https://github.com/rokucommunity/bslint'), '1.0.0');
        expect(lines.slice(5)).to.eql([
            '### Changed',
            ' - Security enhancements ([aaa1111](https://github.com/rokucommunity/bslint/commit/aaa1111), [bbb2222](https://github.com/rokucommunity/bslint/commit/bbb2222))'
        ]);
    });

    describe('curated dependency changelogs', () => {
        const depUrl = 'https://github.com/rokucommunity/brighterscript';
        const link = (prNumber: number) => `[#${prNumber}](${depUrl}/pull/${prNumber})`;

        const newChangelog = [
            '# Changelog',
            '',
            `## [4.0.0-alpha.8](${depUrl}/compare/v4.0.0-alpha.7...v4.0.0-alpha.8) - 2026-09-20`,
            '### Changed',
            ` - Hand edited wording (${link(30)})`,
            ` - Security enhancements (${link(31)})`,
            '### Fixed',
            ` - Fix a crash (${link(32)})`,
            `## [4.0.0-alpha.7](${depUrl}/compare/v4.0.0-alpha.6...v4.0.0-alpha.7) - 2026-09-10`,
            '### Changed',
            ` - Security enhancements (${link(20)}, ${link(21)})`,
            `## [3.18.2](${depUrl}/compare/v3.18.1...v3.18.2) - 2026-09-05`,
            '### Changed',
            ` - Security enhancements (${link(10)})`,
            `## [4.0.0-alpha.6](${depUrl}/compare/v4.0.0-alpha.5...v4.0.0-alpha.6) - 2026-09-01`,
            '### Added',
            ` - Old feature (${link(1)})`
        ].join('\n');
        const oldChangelog = [
            '# Changelog',
            '',
            `## [4.0.0-alpha.6](${depUrl}/compare/v4.0.0-alpha.5...v4.0.0-alpha.6) - 2026-09-01`,
            '### Added',
            ` - Old feature (${link(1)})`
        ].join('\n');

        function getUpgradeLines(options: {
            changelogs: Record<string, string>;
            changedDependencyNames?: string[];
            unchangedDependencyNames?: string[];
            commits?: Array<{ message: string; prNumber: string }>;
            previousVersion?: string;
            newVersion?: string;
        }) {
            const generator = new ChangelogGenerator();
            sinon.stub(generator as any, 'getCommitLogs').callsFake((projectName: string) => {
                return projectName === 'brighterscript' ? (options.commits ?? []).map(x => ({ hash: '', branchInfo: '', message: x.message, prNumber: x.prNumber })) : [];
            });
            sinon.stub(generator as any, 'getVersionDate').returns('2026-09-20');
            sinon.stub(generator as any, 'readDependencyChangelog').callsFake((dir: string, version: string) => options.changelogs[version] ?? '');
            sinon.stub(ProjectManager, 'getProject').callsFake((name: string) => ({
                name: name,
                npmName: '',
                repositoryUrl: `https://github.com/rokucommunity/${name}`,
                dir: '',
                version: '',
                dependencies: [],
                devDependencies: [],
                changes: [],
                lastTag: ''
            }));
            const project = new Project('bslint', '', 'https://github.com/rokucommunity/bslint');
            project.dependencies = [new ProjectDependency('brighterscript', 'brighterscript', options.previousVersion ?? '4.0.0-alpha.6', options.newVersion ?? '4.0.0-alpha.8', depUrl)];
            const unchangedDependencyNames = options.unchangedDependencyNames ?? [];
            for (const name of [...(options.changedDependencyNames ?? []), ...unchangedDependencyNames]) {
                project.devDependencies.push(new ProjectDependency(name, name, '1.0.0', unchangedDependencyNames.includes(name) ? '1.0.0' : '2.0.0', ''));
            }
            return generator['getChangeLogs'](project, '1.0.0').slice(5);
        }

        it('parses conforming headings including prereleases and CRLF', () => {
            const sections = changelogGenerator['parseChangelogSections'](
                [
                    '# Changelog',
                    `## [4.0.0-alpha.8](${depUrl}/compare/a...b) - 2026-09-20  `,
                    ' - first',
                    '## Unreleased',
                    ' - ignored, non-conforming heading ends the previous section',
                    '## [not a version heading',
                    `## [1.2.3](${depUrl}) - 2026-01-02`,
                    ' - second'
                ].join('\r\n')
            );
            expect(sections).to.eql([
                { version: '4.0.0-alpha.8', lines: [' - first'] },
                { version: '1.2.3', lines: [' - second'] }
            ]);
        });

        it('recognizes headings with malformed link or date suffixes', () => {
            const sections = changelogGenerator['parseChangelogSections']([
                `## [1.0.4](${depUrl})- 2021-03-05`,
                ' - a',
                `## [1.0.3](${depUrl}) -2021-03-05`,
                ' - b',
                `## [1.0.2](${depUrl})  - 2021-03-05`,
                ' - c',
                `## [1.0.1](${depUrl}) 2021-03-05`,
                ' - d'
            ].join('\n'));
            expect(sections.map(x => x.version)).to.eql(['1.0.4', '1.0.3', '1.0.2', '1.0.1']);
            expect(sections.map(x => x.lines)).to.eql([[' - a'], [' - b'], [' - c'], [' - d']]);
        });

        it('does not nest bullets across subsections that use different indentation', () => {
            const sections = changelogGenerator['parseChangelogSections']([
                `## [1.0.0](${depUrl}) - 2026-01-02`,
                '### Changed',
                '- upgrade to [brighterscript@1.0.0](url):',
                '    - child',
                '### Fixed',
                ' - a fix',
                ' - another fix'
            ].join('\n'));
            expect(changelogGenerator['extractBullets'](sections)).to.eql([
                { text: '- upgrade to [brighterscript@1.0.0](url):', children: ['    - child'] },
                { text: '- a fix', children: [] },
                { text: '- another fix', children: [] }
            ]);
        });

        it('merges Security enhancements bullets whose reflinks are wrapped in multiple parens', () => {
            const items = [
                { text: `- Security enhancements ((${link(1773)}, ${link(1775)}))`, children: [] },
                { text: `- Security enhancements (${link(1770)})`, children: [] }
            ];
            expect(changelogGenerator['mergeDuplicateBullets'](items, { dir: '', ref: 'v1' })).to.eql([
                `     - Security enhancements (${link(1770)}, ${link(1773)}, ${link(1775)})`
            ]);
        });

        it('selects sections present in the new changelog but not the old, even when versions interleave', () => {
            const newSections = changelogGenerator['parseChangelogSections'](newChangelog);
            const oldSections = changelogGenerator['parseChangelogSections'](oldChangelog);
            expect(changelogGenerator['selectNewSections'](newSections, oldSections).map(x => x.version)).to.eql([
                '4.0.0-alpha.8', '4.0.0-alpha.7', '3.18.2'
            ]);
        });

        it('flattens subheadings and keeps nested lines relative to their item', () => {
            const sections = changelogGenerator['parseChangelogSections']([
                `## [1.0.0](${depUrl}) - 2026-01-02`,
                '### Added',
                ' - first',
                '     - nested',
                '       wrapped',
                '### Fixed',
                '- second'
            ].join('\n'));
            expect(changelogGenerator['extractBullets'](sections)).to.eql([
                { text: '- first', children: ['    - nested', '      wrapped'] },
                { text: '- second', children: [] }
            ]);
        });

        it('aggregates all new versions and merges Security enhancements reflinks', () => {
            const lines = getUpgradeLines({ changelogs: { '4.0.0-alpha.8': newChangelog, '4.0.0-alpha.6': oldChangelog } });
            expect(lines).to.eql([
                '### Changed',
                ` - upgrade to [brighterscript@4.0.0-alpha.8](${depUrl}/blob/v4.0.0-alpha.8/CHANGELOG.md#400-alpha8---2026-09-20). Notable changes since 4.0.0-alpha.6:`,
                `     - Hand edited wording (${link(30)})`,
                `     - Security enhancements (${link(10)}, ${link(20)}, ${link(21)}, ${link(31)})`,
                `     - Fix a crash (${link(32)})`
            ]);
        });

        describe('nested dependency blocks', () => {
            const nestedChangelog = [
                `## [2.0.0](${depUrl}) - 2026-09-20`,
                '### Changed',
                ' - Own change (#5)',
                ` - upgrade to [roku-deploy@4.0.0](https://github.com/rokucommunity/roku-deploy/blob/v4.0.0/CHANGELOG.md#400---2026-09-19). Notable changes since 3.0.0:`,
                '     - deploy change ([#9](https://github.com/rokucommunity/roku-deploy/pull/9))',
                `## [1.0.0](${depUrl}) - 2026-01-01`
            ].join('\n');
            const oldNestedChangelog = `## [1.0.0](${depUrl}) - 2026-01-01`;

            it('removes the block when the target directly depends on that package and it changed', () => {
                const lines = getUpgradeLines({
                    changelogs: { '2.0.0': nestedChangelog, '1.0.0': oldNestedChangelog },
                    changedDependencyNames: ['roku-deploy'],
                    previousVersion: '1.0.0',
                    newVersion: '2.0.0'
                });
                expect(lines.slice(2, 3)).to.eql(['     - Own change (#5)']);
                //the nested block is dropped; the direct dependency gets its own upgrade block instead
                expect(lines.some(line => line.includes('roku-deploy@4.0.0'))).to.be.false;
                expect(lines[3]).to.contain('upgrade to [roku-deploy@2.0.0]');
            });

            it('keeps the block when the direct dependency on that package is unchanged', () => {
                const lines = getUpgradeLines({
                    changelogs: { '2.0.0': nestedChangelog, '1.0.0': oldNestedChangelog },
                    unchangedDependencyNames: ['roku-deploy'],
                    previousVersion: '1.0.0',
                    newVersion: '2.0.0'
                });
                expect(lines).to.have.lengthOf(5);
                expect(lines[3]).to.contain('upgrade to [roku-deploy@4.0.0]');
            });

            it('keeps the block, re-indented, when the target does not depend on it', () => {
                const lines = getUpgradeLines({
                    changelogs: { '2.0.0': nestedChangelog, '1.0.0': oldNestedChangelog },
                    previousVersion: '1.0.0',
                    newVersion: '2.0.0'
                });
                expect(lines.slice(2)).to.eql([
                    '     - Own change (#5)',
                    '     - upgrade to [roku-deploy@4.0.0](https://github.com/rokucommunity/roku-deploy/blob/v4.0.0/CHANGELOG.md#400---2026-09-19). Notable changes since 3.0.0:',
                    '         - deploy change ([#9](https://github.com/rokucommunity/roku-deploy/pull/9))'
                ]);
            });
        });

        it('emits the header with no sub-bullets when the new sections are empty', () => {
            const emptyChangelog = [
                `## [2.0.0](${depUrl}) - 2026-09-20`,
                `## [1.0.0](${depUrl}) - 2026-01-01`,
                ' - Old'
            ].join('\n');
            const lines = getUpgradeLines({
                changelogs: { '2.0.0': emptyChangelog, '1.0.0': `## [1.0.0](${depUrl}) - 2026-01-01\n - Old` },
                commits: [{ message: 'should not appear', prNumber: '1' }],
                previousVersion: '1.0.0',
                newVersion: '2.0.0'
            });
            expect(lines).to.have.lengthOf(2);
            expect(lines[1]).to.contain('upgrade to [brighterscript@2.0.0]');
        });

        describe('falls back to commit messages', () => {
            const commits = [{ message: 'added a dep feature', prNumber: '7' }];
            const expectedFallback = (version: string) => [
                '### Changed',
                ` - upgrade to [brighterscript@${version}](${depUrl}/blob/v${version}/CHANGELOG.md#${version.replace(/\./g, '')}---2026-09-20). Notable changes since 4.0.0-alpha.6:`,
                `     - added a dep feature (${link(7)})`
            ];

            it('when the new tag has no changelog', () => {
                expect(getUpgradeLines({ changelogs: { '4.0.0-alpha.6': oldChangelog }, commits: commits, newVersion: '4.0.0-alpha.8' }))
                    .to.eql(expectedFallback('4.0.0-alpha.8'));
            });

            it('when the old tag has no changelog', () => {
                expect(getUpgradeLines({ changelogs: { '4.0.0-alpha.8': newChangelog }, commits: commits }))
                    .to.eql(expectedFallback('4.0.0-alpha.8'));
            });

            it('when no conforming headings parse at the new tag', () => {
                expect(getUpgradeLines({ changelogs: { '4.0.0-alpha.8': '# Changelog\n## Unreleased\n - x', '4.0.0-alpha.6': oldChangelog }, commits: commits }))
                    .to.eql(expectedFallback('4.0.0-alpha.8'));
            });

            it('when the new version heading is missing', () => {
                expect(getUpgradeLines({ changelogs: { '4.0.0-alpha.8': oldChangelog, '4.0.0-alpha.6': oldChangelog }, commits: commits }))
                    .to.eql(expectedFallback('4.0.0-alpha.8'));
            });
        });
    });
});
