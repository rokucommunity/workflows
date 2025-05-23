# Release Workflow System

This repository holds reusable and template workflows for the new release system.

## Table of Contents

- [Overview](#overview)
- [Workflow Templates](#workflow-templates)
- [Shared CI](#shared-ci)
  - [Step 1: Initialize Release](#step-1-initialize-release)
  - [Step 2: Make Release Artifacts](#step-2-make-release-artifacts)
  - [Step 3: Publish Release](#step-3-publish-release)
- [Repository Setup](#repository-setup)
  - [Setting Up Template Workflows in a Repository](#setting-up-template-workflows-in-a-repository)
- [Recovering from a Failed Release CI](#recovering-from-a-failed-release-ci)
- [Command Line](#command-line)

---

## Overview

The CI flow consists of three key steps: **[Initialize Release](#step-1-initialize-release), [Make Release Artifacts](#step-2-make-release-artifacts), and [Publish Release](#step-3-publish-release)**. These workflows ensure a structured process for versioning, creating artifacts, and publishing new releases.

---

## Workflow Templates

Each workflow step has an associated **template** to set up workflow triggers and call the reusable workflows from the Shared CI.

### Template Purposes:

- Hook into repository workflow triggers.
- Call reusable workflows in the Shared CI.
- Standardize workflow execution across repositories.

---

## Shared CI

### Step 1: Initialize Release

- **Purpose**: Prepares a new release by incrementing the version and creating a release branch.
- **Triggers**: Manual dispatch with required parameters.
- **Actions**:
  1. Increment the version number.
  2. Create and checkout a new branch (`release/version`).
  3. Commit the updated version number.
  4. Update and commit the changelog.
  5. Open a draft GitHub release.
  6. Create a pull request for review. _Note, this new pull request will trigger the next step._
- **Required Parameters**:
  - `branch` target branch for the release
  - `release_type` e.g., major, minor, patch, prerelease
  - `customVersion` Ignore `release_type` and use this specified version
  - `installDependencies` Automatically install other RokuCommunity dependencies
- [Initialize Release Template](https://github.com/rokucommunity/.github/blob/master/workflow-templates/initialize-release.yml)

### Step 2: Make Release Artifacts

- **Purpose**: Makes the release artifacts, and upload them.
- **Triggers**: Pushes and updates to `release/*` branches.
- **Actions**:
    1. Build the release artifacts.
    2. Upload artifacts to the draft GitHub release.
    3. Sets the GitHub Release body equal to the changes in the ChangeLog
- **Required Parameters** _(these are hardcoded in the template)_:
  - `branch` The head ref for the release PR
  - `node-version` The node version used to build the artifacts. If needed edit the template when you add it to your project
  - `asset-paths` The glob path used to get all the release artifacts
- [Make Release Artifacts Release Template](https://github.com/rokucommunity/.github/blob/master/workflow-templates/make-release-artifacts.yml)
### Step 3: Publish Release


- **Purpose**: Finalizes the release by marking it as non-draft and publishing the code.
- **Triggers**: Merging of a `release/*` branch.
- **Actions**:
  1. Mark the GitHub release as non-draft.
  2. Publish the release to users (e.g., npm, VS Code Marketplace).
- [Publish Release Template](https://github.com/rokucommunity/.github/blob/master/workflow-templates/publish-release.yml)
- **Required Parameters** _(these are hardcoded in the template)_:
  - `branch` The head ref for the release PR
  - `release-store` The head ref for the release PR. If needed, specify what release store you are publishing to

---

## Repository Setup

To integrate this release workflow system into a new repository, follow these steps:

1. **Add Workflow Templates**: Each repository must include the workflow templates: `initialize-release`, `make-release-artifacts`, `publish-release` from this repository. More details in this section: [Setting Up Template Workflows in a Repository](#setting-up-template-workflows-in-a-repository)

     [_Example repository workflow setup_](https://github.com/rokucommunity/release-testing/tree/master/.github/workflows)

2. **Ensure Required NPM Script Exist**:
   - `package`: Compiles the application.

   _Example `package.json`_
   ```json
    "scripts": {
      "package": "npm run build && npm pack"
    },
   ```
3. **Build Artifacts Paths**:
   - The `package` script name and place all artifacts in a way that the `asset-paths` set in [Make Release Artifacts Release Template](https://github.com/rokucommunity/.github/blob/master/workflow-templates/make-release-artifacts.yml) is selectable.
   - The post-build step will look for release artifacts in this directory to upload to the GitHub release.

---
### Setting Up Template Workflows in a Repository

To integrate the release workflow system into a repository, follow these steps to add the required workflow templates from the **RokuCommunity** organization:

### Step 1: Add Workflow Templates
1. Navigate to your repository on GitHub.
2. Click on the **Actions** tab.
3. Click **New workflow** or go directly to `.github/workflows`.
4. Under **"Choose a workflow"**, find the **By RokuCommunity** templates:
   - **Initialize Release**
   - **Make Release Artifacts**
   - **Publish Release**
5. Click on each template and select **"Configure"**.

### Step 2: Check needed edits
1. Edit `asset-paths` if needed
2. Edit `node-version` if needed
2. Edit `publish-store` if needed

### Step 3: Commit the Workflow Files
1. Click **Commit changes...**.
2. Ensure the commit is made to the default branch (master)
5. Click **Commit changes**

Once these workflows are set up, your repository will automatically follow the structured release process!

---
## Recovering from a Failed Release CI, or Closing a Release

If a workflow fails, rerunning the workflow is safe to do and may solve the problem.

If you want to cleanup an inflight release, the best way is to close the release branch that was create. If there was no release branch create, then there is nothing to cleanup.

Closing the release branch will do these 3 steps: delete the GitHub Release, delete the pull request for the release, delete the release branch. You can do these steps manaully by following the instructions below:

1. **Delete the GitHub Release**
   - Go to the **Releases** section of your repository.
   - Find the failed release.
   - Click **Delete release**.

2. **Delete the Pull Request for the Release**
   - Navigate to the **Pull Requests** tab.
   - Locate the pull request associated with the release.
   - Close and delete the pull request.

3. **Delete the Release Branch**
   - Go to the **Branches** section of your repository.
   - Find the branch created for the release (e.g., `release/version`).
   - Delete the branch.

_Note there is a [workflow template: Delete Release](https://github.com/rokucommunity/.github/blob/master/workflow-templates/delete-release.yml) that does all three steps_
