import { error, getInput, setFailed } from "@actions/core";
import { context, getOctokit } from "@actions/github";
import { Buffer } from "buffer";
import { HttpClient } from "@actions/http-client";

const http = new HttpClient();

type Validation = {
  isValid: boolean;
  errors: string[];
};

export async function run() {
  const token = getInput("gh-token");

  const octokit = getOctokit(token);
  const pullRequest = context.payload.pull_request;

  try {
    // Extract source and destination organizations
    const sourceOrg = pullRequest!.head.repo.owner.login;
    const baseOrg = pullRequest!.base.repo.owner.login;

    // Extract source and destination repositories
    const sourceRepo = pullRequest!.head.repo.full_name;
    const baseRepo = pullRequest!.base.repo.full_name;

    // Extract all files from the pull request
    const allFiles = await octokit.rest.pulls
      .listFiles({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pullRequest!.number,
      })
      .then((files) =>
        files.data.map((file) => { file.filename, file.blob_url, file.contents_url, file.raw_url })
      );

    // Show all the variables for debugging purposes
    console.log(sourceOrg);
    console.log(sourceRepo);
    console.log(baseOrg);
    console.log(baseRepo);
    console.log(allFiles);

    // Extract the files that end with sample.json
    const files = await octokit.rest.pulls
      .listFiles({
        owner: context.repo.owner,
        repo: context.repo.repo,
        pull_number: pullRequest!.number,
      })
      .then((files) =>
        files.data.filter((file) => file.filename.endsWith("sample.json"))
      );

    const errors = [] as {
      fileUrl: string;
      body: Validation;
    }[];

    const filePromises = files.map(async (file) => {
      const fileData = await octokit.request(file.contents_url);
      const fileContent = Buffer.from(
        fileData.data.content,
        "base64"
      ).toString();

      const res = await http.post(
        "https://m365-galleries.azurewebsites.net/Samples/validateSample",
        fileContent,
        {
          "Content-Type": "application/json",
        }
      );

      const body: Validation = JSON.parse(await res.readBody());

      if (!body.isValid) {
        errors.push({ fileUrl: file.blob_url, body });
      }
    });

    await Promise.all(filePromises);

    if (errors.length > 0) {
      const body = errors
        .map((e) => {
          return `File: ${getFileMarkdownUrl(e.fileUrl)}\n${e.body.errors
            .map((e) => "- " + e)
            .join("\n")}\n`;
        })
        .join("\n");


      try {
        octokit.rest.issues.createComment({
          issue_number: context.issue.number,
          owner: context.repo.owner,
          repo: context.repo.repo,
          body: `### Validation failed!\n${body}`,
        });
      } catch (error) {
        console.log(body);
      }

      setFailed("Invalid samples!");
    }
  } catch (error) {
    console.log(error);
    setFailed(error as any);
  }
}

run();

function getFileMarkdownUrl(blobUrl: string) {
  const [_, ...rest] = blobUrl.split("blob/")[1].split("/");
  const name = rest.join("/");

  return `[${decodeURIComponent(name)}](${blobUrl})`;
}
