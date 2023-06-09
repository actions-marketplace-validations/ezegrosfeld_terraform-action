import {exec} from 'child_process';
import {Commands} from './utils/cmd';
import {Octokit} from '@octokit/core';
import * as core from '@actions/core';
import * as github from '@actions/github';
import {buildApplyMessage, formatOutput} from './utils/ouput';

declare const GitHub: typeof Octokit &
    import('@octokit/core/dist-types/types').Constructor<import('@octokit/plugin-rest-endpoint-methods/dist-types/types').Api & {
        paginate: import('@octokit/plugin-paginate-rest').PaginateInterface;
    }>;

export type Client = InstanceType<typeof GitHub>;

export class Terraform {
    #client: Client;
    #workspace: string;

    constructor(client: Client) {
        this.#client = client;
        this.#workspace = "dev";
    }

    workspace = (workspace: string) => {
        this.#workspace = workspace;
    };

    executeTerraform = async (cmd: Commands, dir: string): Promise<void> => {
        let chdir = "."
        if (dir !== '') {
            chdir = dir;
        }

        const def_dir = core.getInput('default_dir');

        if (def_dir !== '') {
            chdir = def_dir;
        }

        const res = await this.#client.rest.checks.create({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            name: `terraform-pr-${cmd}`,
            head_sha: github.context.sha,
            status: 'in_progress',
            output: {
                title: `Terraform ${cmd}`,
                summary: `Running Terraform ${cmd}`,
                text: `Running Terraform ${cmd}`,
            },
        });
        if (res.status !== 201) {
            throw new Error(`Failed to create check, status: ${res.status}`);
        }

        try {
            switch (cmd) {
                case Commands.Plan:
                    this.#terraformInit(chdir, () => this.#plan(chdir));
                    break;
                case Commands.Apply:
                    this.#terraformInit(chdir, () => this.#apply(chdir));
                    break;
                case Commands.PlanDestroy:
                    this.#terraformInit(chdir, () => this.#planDestroy(chdir));
                    break;
                case Commands.ApplyDestroy:
                    this.#terraformInit(chdir, () => this.#applyDestroy(chdir));
                    break;
                default:
                    break;
            }
        } catch (e: any) {
            throw new Error(e);
        }
    };

    #terraformInit = (chdir: string, fn: () => void) => {
        try {
            exec(
                `terraform ${chdir && '-chdir=' + chdir} init -input=false`,
                async (err, stdout, stderr) => {
                    core.startGroup('Terraform Init');
                    core.info(stdout);
                    if (err) {
                        const comment = this.#buildOutputDetails(stdout, true, this.#workspace, chdir);
                        await this.#createComment('Terraform `init` failed', comment);
                        return
                    }

                    if (stderr) {
                        const comment = this.#buildOutputDetails(stdout, true, this.#workspace, chdir);
                        await this.#createComment('Terraform `init` failed', comment);
                        return
                    }
                    core.endGroup();
                    try {
                        this.#setWorkspace(chdir, fn);
                    } catch (e: any) {
                        throw new Error(e);
                    }
                }
            );
        } catch (e: any) {
            throw new Error(e);
        }
    };

    #setWorkspace = (chdir: string, fn: () => void) => {
        try {
            exec(
                `terraform ${chdir && '-chdir=' + chdir} workspace select ${
                    this.#workspace
                } || terraform ${
                    chdir && '-chdir=' + chdir
                } workspace new ${this.#workspace}`,
                (err, stdout, stderr) => {
                    core.startGroup('Terraform Workspace');
                    core.info(stdout);

                    core.endGroup();

                    try {
                        fn();
                    } catch (e: any) {
                        throw new Error(e);
                    }
                }
            );
        } catch (e: any) {
            throw new Error(e);
        }
    };

    #plan = (chdir: string, comment: boolean = true, fn?: () => void) => {
        try {
            exec(
                `terraform ${chdir && '-chdir=' + chdir} plan -no-color`,
                async (err, stdout, stderr) => {
                    core.startGroup('Terraform Plan');
                    core.info(stdout);
                    if (err) {
                        const comment = this.#buildOutputDetails(stdout, true, this.#workspace, chdir);
                        await this.#createComment('Terraform `plan` failed', comment);
                        return
                    }

                    if (stderr) {
                        const comment = this.#buildOutputDetails(stdout, true, this.#workspace, chdir);
                        await this.#createComment('Terraform `plan` failed', comment);
                        return
                    }

                    // add comment to issue with plan
                    if (comment) {
                        const msg = this.#buildOutputDetails(stdout, true, this.#workspace, chdir);
                        await this.#createComment('Terraform `plan`', msg);
                        return
                    }

                    typeof fn !== 'undefined' && fn();

                    core.endGroup();
                }
            );
        } catch (e: any) {
            throw new Error(e);
        }
    };

    #apply = (chdir: string) => {
        try {
            exec(
                `terraform ${
                    chdir && '-chdir=' + chdir
                } apply -no-color -auto-approve`,
                async (err, stdout, stderr) => {
                    core.startGroup('Terraform Apply');
                    core.info(stdout);

                    if (err) {
                        const comment = this.#buildOutputDetails(stdout, false, this.#workspace, chdir);
                        await this.#createComment('Terraform `apply` failed', comment);
                        return
                    }

                    if (stderr) {
                        const comment = this.#buildOutputDetails(stdout, false, this.#workspace, chdir);
                        await this.#createComment('Terraform `apply` failed', comment);
                        return
                    }

                    const comment = this.#buildOutputDetails(stdout, false, this.#workspace, chdir);
                    await this.#createComment('Terraform `apply`', comment);

                    core.endGroup();
                }
            );
        } catch (e: any) {
            throw new Error(e);
        }
    };

    #planDestroy = (chdir: string, comment: boolean = true, fn?: () => void) => {
        try {
            exec(
                `terraform ${
                    chdir && '-chdir=' + chdir
                } plan -destroy -no-color`,
                async (err, stdout, stderr) => {
                    core.startGroup('Terraform Plan Destroy');
                    core.info(stdout);

                    if (err) {
                        const comment = this.#buildOutputDetails(stdout, true, this.#workspace, chdir);
                        await this.#createComment(
                            'Terraform `plan-destroy` failed',
                            comment
                        );
                        return
                    }

                    if (stderr) {
                        const comment = this.#buildOutputDetails(stdout, true, this.#workspace, chdir);
                        await this.#createComment(
                            'Terraform `plan-destroy` failed',
                            comment
                        );
                        return
                    }

                    // add comment to issue with plan
                    if (comment) {
                        const msg = this.#buildOutputDetails(stdout, true, this.#workspace, chdir);
                        await this.#createComment('Terraform `plan-destroy`', msg);
                    }

                    typeof fn !== 'undefined' && fn();

                    core.endGroup();
                }
            );
        } catch (e: any) {
            throw new Error(e);
        }
    };

    #applyDestroy = (chdir: string) => {
        try {
            exec(
                `terraform ${
                    chdir && '-chdir=' + chdir
                } apply -destroy -no-color -auto-approve`,
                async (err, stdout, stderr) => {
                    core.startGroup('Terraform Apply Destroy');
                    core.info(stdout);

                    if (err) {
                        const comment = this.#buildOutputDetails(stdout, false, this.#workspace, chdir);
                        await this.#createComment(
                            'Terraform `apply-destroy` failed',
                            comment
                        );
                    }

                    if (stderr) {
                        const comment = this.#buildOutputDetails(stdout, false, this.#workspace, chdir);
                        await this.#createComment(
                            'Terraform `apply-destroy` failed',
                            comment
                        );
                    }

                    const comment = this.#buildOutputDetails(stdout, false, this.#workspace, chdir);
                    await this.#createComment('Terraform `apply-destroy`', comment);

                    core.endGroup();
                }
            );
        } catch (e: any) {
            throw new Error(e);
        }
    };

    #createComment = async (title: string, comment: string) => {
        const msg = `## ${title}: \n\n${comment}`;

        await this.#client.rest.issues.createComment({
            owner: github.context.repo.owner,
            repo: github.context.repo.repo,
            issue_number: github.context.issue.number,
            body: msg,
        });
    };

    #buildOutputDetails = (details: string, message: boolean = false, workspace?: string, dir?: string): string => {
        return `<details><summary>Show output</summary>\n<p>\n\n\`\`\`diff\n${formatOutput(
            details
        )}\n\`\`\`\n${message ? `###### 💡 To plan:\n\tterraform plan -w ${workspace} -d ${dir}\n###### 🚀 To apply\n\tterraform apply -w ${workspace} -d ${dir}\n###### 👀 To plan-destroy: \`terraform plan-destroy -w ${workspace} -d ${dir}\`\n###### 💀 To apply-destroy: \`terraform apply-destroy -w ${workspace} -d ${dir}\`\n` : ''}</p></details>
        <hr/>
        <h6>Directory: ${dir}</h6>
        <h6>Workspace: ${workspace}</h6>`
    };
}
