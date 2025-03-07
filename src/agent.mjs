import { Octokit } from "@octokit/rest";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";
import { RunnableLambda, RunnableMap } from "@langchain/schema/runnable";
import { Graph } from "@langchain/langgraph";

const SYSTEM_PROMPT = `
Given the following code changes in the pull request, please analyze the logic and structure. Provide comments that address the following aspects:

- Code Logic: Identify any logical errors or inefficiencies in the code.
- Good Code Practices: Suggest improvements based on best practices, such as naming conventions, code organization, and readability.
- Security Issues: Highlight any potential security vulnerabilities, such as unvalidated inputs, outdated dependencies, or improper error handling.

Format: Return the comments in an array format, including:
- Specific line numbers or code snippets referenced.
- Actionable suggestions for each identified issue.

Please ensure that the comments are clear, concise, and aimed at helping the developer improve the code quality. The output should be in the following format:

[
  {
    "file": "filename.py",
    "line": line_number,
    "suggestion": "Your suggestion here.",
    "type": "Type of issue (Logic, Good Code Practice, Security)"
  }
]
`;

const REVIEW_PROMPT = `
You are a review agent that validates and refines AI-generated comments. Your task is:
- Remove hallucinations (incorrect or vague feedback).
- Improve clarity and ensure suggestions are relevant.
- Ensure the suggestions align with best coding practices.

Format the output as a valid JSON array, same as the input format.
`;

const DEDUPE_PROMPT = `
You are an AI agent that filters and consolidates comments before posting. Your tasks:
- Retrieve existing comments from the PR.
- Remove duplicate or redundant suggestions.
- Merge similar comments to avoid spamming developers.

Format the output as a valid JSON array, same as the input format.
`;

const llm = new ChatGoogleGenerativeAI({ model: "gemini-1.5-pro", temperature: 0, maxRetries: 2, apiKey: process.env.GEMINI_API_KEY });
const octokit = new Octokit({ auth: process.env.API_TOKEN });

async function fetchPRCodeChanges({ owner, repo, pull_number }) {
  try {
    const filesResponse = await octokit.rest.pulls.listFiles({ owner, repo, pull_number });
    return filesResponse.data.map(file => `File: ${file.filename}\n${file.patch}\n`).join('\n');
  } catch (error) {
    console.error(`Error fetching PR code changes: ${error.message}`);
    throw error;
  }
}

async function analyzeCodeChanges({ codeChanges }) {
  const aiMsg = await llm.invoke([["system", SYSTEM_PROMPT], ["human", codeChanges]]);
  return parseAIResponse(aiMsg.content);
}

async function refineComments({ rawComments }) {
  const reviewMsg = await llm.invoke([["system", REVIEW_PROMPT], ["human", JSON.stringify(rawComments)]]);
  return parseAIResponse(reviewMsg.content);
}

async function fetchExistingComments({ owner, repo, pull_number }) {
  try {
    const commentsResponse = await octokit.rest.issues.listComments({ owner, repo, issue_number: pull_number });
    return commentsResponse.data.map(comment => comment.body).join('\n');
  } catch (error) {
    console.error(`Error fetching existing comments: ${error.message}`);
    return "";
  }
}

async function deduplicateAndMergeComments({ refinedComments, existingComments }) {
  const dedupeMsg = await llm.invoke([["system", DEDUPE_PROMPT], ["human", JSON.stringify({ refinedComments, existingComments })]]);
  return parseAIResponse(dedupeMsg.content);
}

async function addPRComment({ owner, repo, prNumber, comments }) {
  if (!Array.isArray(comments)) {
    console.error("Expected an array of comments but got:", typeof comments);
    return;
  }
  try {
    for (const comment of comments) {
      const commentBody = `*File:* ${comment.file}\n*Line:* ${comment.line}\n*Type:* ${comment.type}\n\n*Suggestion:*\n${comment.suggestion}`;
      await octokit.issues.createComment({ owner, repo, issue_number: prNumber, body: commentBody });
      console.log("Comment added successfully for file:", comment.file);
    }
  } catch (error) {
    console.error(`Error adding comment: ${error.message}`);
  }
}

const graph = new Graph();
graph.addNode("fetchPRCodeChanges", new RunnableLambda(fetchPRCodeChanges));
graph.addNode("analyzeCodeChanges", new RunnableLambda(analyzeCodeChanges));
graph.addNode("refineComments", new RunnableLambda(refineComments));
graph.addNode("fetchExistingComments", new RunnableLambda(fetchExistingComments));
graph.addNode("deduplicateAndMergeComments", new RunnableLambda(deduplicateAndMergeComments));
graph.addNode("addPRComment", new RunnableLambda(addPRComment));

graph.addEdge("fetchPRCodeChanges", "analyzeCodeChanges");
graph.addEdge("analyzeCodeChanges", "refineComments");
graph.addEdge("refineComments", "fetchExistingComments");
graph.addEdge("fetchExistingComments", "deduplicateAndMergeComments");
graph.addEdge("deduplicateAndMergeComments", "addPRComment");

const runnable = graph.compile();

async function generatePRComments(owner, repo, pull_number) {
  await runnable.invoke({ owner, repo, pull_number });
}

// Example usage
const owner = process.env.OWNER;
const repo = process.env.REPO;
const pull_number = process.env.PULL_NUMBER;

generatePRComments(owner, repo, pull_number).catch(error => {
  console.error('Error generating comments:', error);
});
