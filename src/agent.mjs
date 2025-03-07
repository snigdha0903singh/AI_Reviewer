import { Octokit } from "@octokit/rest";
import {GoogleGenerativeAI} from "@google/generative-ai";
import { ChatGoogleGenerativeAI } from "@langchain/google-genai";


//const genAI = new GoogleGenerativeAI(GEMINI_API_KEY);
//const model = genAI.getGenerativeModel({ model: "gemini-2.0-flash" });
// dotenv.config();
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

const llm = new ChatGoogleGenerativeAI({
  model: "gemini-1.5-pro",
  temperature: 0,
  maxRetries: 2,
  apiKey:process.env.GEMINI_API_KEY,
});

const octokit = new Octokit({
  auth: process.env.API_TOKEN,
});


async function fetchPRCodeChanges(owner, repo, pull_number) {
  try {
    const filesResponse = await octokit.rest.pulls.listFiles({
      owner,
      repo,
      pull_number,
    });

    const files = filesResponse.data;
    let codeChanges = '';

    for (const file of files) {
      const { filename, patch } = file;
      codeChanges += `File: ${filename}\n${patch}\n\n`;
    }

    return codeChanges;
  } catch (error) {
    console.error(`Error fetching PR code changes: ${error.message}`);
    throw error;
  }
}

async function addPRComment(owner, repo, prNumber, comments) {

    try {
      const response = await octokit.issues.createComment({
        owner,
        repo,
        issue_number: prNumber,
        body: comments,
      });
      console.log("Comment added successfully:", comments);
      //console.log(`comment is:${comments}`)
    } catch (error) {
      console.error(`Error adding comment: ${error.message}`);
    }
  
}


async function analyzeCodeChanges(codeChanges) {
  const aiMsg = await llm.invoke([
    [
      "system",
      SYSTEM_PROMPT,
    ],
    ["human", codeChanges],
  ]);
  aiMsg;
  // const prompt=SYSTEM_PROMPT+codeChanges;
  // const result = await model.generateContent(prompt);
  // const responseText = result.response.text();
  return aiMsg.content;
}


async function generatePRComments(owner, repo, pull_number) {
  const codeChanges = await fetchPRCodeChanges(owner, repo, pull_number);
  const analysis = await analyzeCodeChanges(codeChanges);
  return analysis
}

// Example usage
const owner = process.env.OWNER;
const repo = process.env.REPO;
const pull_number = process.env.PULL_NUMBER;

generatePRComments(owner, repo, pull_number)
  .then(comments => {
    try {
      addPRComment(owner, repo, pull_number, comments);
      console.log('added comments:');
    }
    catch(error){
      console.log(`Error adding comments:${error.message}`);
    }
    
  })
  .catch(error => {
    console.error('Error generating comments:', error);
  });