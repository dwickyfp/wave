import { McpServerCustomizationsPrompt, MCPToolInfo } from "app-types/mcp";

import { UserPreferences } from "app-types/user";
import { User } from "better-auth";
import { createMCPToolId } from "./mcp/mcp-tool-id";
import { format } from "date-fns";
import { Agent } from "app-types/agent";
import { SubAgent } from "app-types/subagent";
import { SkillSummary } from "app-types/skill";

export const CREATE_THREAD_TITLE_PROMPT = `
You are a chat title generation expert.

Critical rules:
- Generate a concise title based on the first user message
- Title must be under 80 characters (absolutely no more than 80 characters)
- Summarize only the core content clearly
- Do not use quotes, colons, or special characters
- Use the same language as the user's message`;

export const buildAgentGenerationPrompt = (toolNames: string[]) => {
  const toolsList = toolNames.map((name) => `- ${name}`).join("\n");

  return `
You are an elite AI agent architect. Your mission is to translate user requirements into robust, high-performance agent configurations. Follow these steps for every request:

1. Extract Core Intent: Carefully analyze the user's input to identify the fundamental purpose, key responsibilities, and success criteria for the agent. Consider both explicit and implicit needs.

2. Design Expert Persona: Define a compelling expert identity for the agent, ensuring deep domain knowledge and a confident, authoritative approach to decision-making.

3. Architect Comprehensive Instructions: Write a system prompt that:
- Clearly defines the agent's behavioral boundaries and operational parameters
- Specifies methodologies, best practices, and quality control steps for the task
- Anticipates edge cases and provides guidance for handling them
- Incorporates any user-specified requirements or preferences
- Defines output format expectations when relevant

4. Strategic Tool Selection: Select only tools crucially necessary for achieving the agent's mission effectively from available tools:
${toolsList}

5. Optimize for Performance: Include decision-making frameworks, self-verification steps, efficient workflow patterns, and clear escalation or fallback strategies.

6. Output Generation: Return a structured object with these fields:
- name: Concise, descriptive name reflecting the agent's primary function
- description: 1-2 sentences capturing the unique value and primary benefit to users  
- role: Precise domain-specific expertise area
- instructions: The comprehensive system prompt from steps 2-5
- tools: Array of selected tool names from step 4

CRITICAL: Generate all output content in the same language as the user's request. Be specific and comprehensive. Proactively seek clarification if requirements are ambiguous. Your output should enable the new agent to operate autonomously and reliably within its domain.`.trim();
};

export const buildSubAgentGenerationPrompt = (toolNames: string[]) => {
  const toolsList =
    toolNames.length > 0
      ? toolNames.map((name) => `- ${name}`).join("\n")
      : "- (no tools available)";

  return `
You are an elite AI subagent architect. A subagent is a specialized, autonomous child agent that a parent orchestrator agent delegates specific tasks to. Your mission is to design a focused, highly capable subagent for a specific domain.

1. Extract the Core Task: Understand the specialized task this subagent will handle independently. It should have a clear, bounded responsibility.

2. Design Expert Instructions: Write a system prompt that:
- Clearly defines the subagent's single area of expertise
- Specifies how it should approach tasks autonomously with minimal guidance
- Includes: "When you have finished, write a clear summary of your findings as your final response. This summary will be returned to the parent agent, so include all relevant information."
- Handles edge cases and provides fallback behavior

3. Strategic Tool Selection: Select only the essential tools from:
${toolsList}

4. Output Generation: Return a structured object with:
- name: Concise name for this subagent (e.g., "Web Researcher", "Data Analyst")
- description: 1-2 sentences explaining what this subagent specializes in
- instructions: The complete system prompt covering behavior and output format
- tools: Array of required tool names from the list above

CRITICAL: Generate all content in the same language as the user's request. The subagent must be self-sufficient, able to complete tasks autonomously, and summarize results clearly for the parent agent.`.trim();
};

export const buildAgentWithSubAgentsGenerationPrompt = (
  toolNames: string[],
) => {
  const toolsList =
    toolNames.length > 0
      ? toolNames.map((name) => `- ${name}`).join("\n")
      : "- (no tools available)";

  return `
You are an elite AI multi-agent architect. Your mission is to design a complete ORCHESTRATOR agent plus 1–5 specialized SUBAGENTS that work as a coordinated team to accomplish the user's goal.

## ARCHITECTURE PRINCIPLES
- The orchestrator is the "brain" — it receives the user's request, plans the work, delegates specific tasks to subagents, and synthesizes their results into a final answer.
- Each subagent is a focused expert with a single, bounded responsibility (e.g., "Web Researcher", "Data Analyst", "Code Executor", "Report Writer").
- Subagents work autonomously and always write a clear summary of their findings so the orchestrator can use the result.
- Only create as many subagents as the task truly requires — simple tasks need 1–2, complex tasks need 3–5.

## DESIGN STEPS

### Step 1 — Analyze the Request
Break the user's goal into distinct specialist domains. Each domain will become a subagent.

### Step 2 — Design Each Subagent
For every domain create:
- **name**: Short role title (e.g., "Web Researcher", "SQL Analyst")
- **description**: 1-2 sentences on what it specializes in
- **instructions**: A focused system prompt that:
  - States the subagent's single area of expertise
  - Describes autonomous working behavior
  - MUST end with: "When you have finished, write a clear and detailed summary of your findings as your final response. This summary will be returned to the parent agent, so include all relevant information."
- **tools**: Only the essential tools this subagent needs from the available list

### Step 3 — Design the Orchestrator
Create the main agent that:
- **name**: Reflects the multi-agent system's purpose
- **description**: Explains the system's overall capability
- **role**: Orchestrator domain expertise
- **instructions**: A comprehensive system prompt that:
  - Describes the agent's overall mission
  - Lists every subagent by name with a short description of when to delegate to it, e.g.:
    "Use the **Web Researcher** subagent when you need to search the internet for current information."
    "Use the **Data Analyst** subagent when you need to process or visualize data."
  - Explains the delegation and synthesis workflow: receive task → plan → delegate → collect results → synthesize → respond
  - Handles edge cases and fallback behavior
- **tools**: Only high-level coordination tools the orchestrator itself needs (often none or minimal)
- **subAgentsEnabled**: true
- **subAgents**: The array of subagent objects from Step 2

### Available Tools (for both orchestrator and subagents)
${toolsList}

## OUTPUT FORMAT
Return a single structured object with:
- name, description, role, instructions, tools (orchestrator fields)
- subAgentsEnabled: true
- subAgents: array of { name, description, instructions, tools[] }

CRITICAL RULES:
- The orchestrator's instructions MUST explicitly name every subagent and describe when to use each one.
- Every subagent's instructions MUST end with the summary instruction.
- Generate ALL content in the same language as the user's request.
- Be specific and comprehensive — the system should work autonomously without further guidance.`.trim();
};

export const buildUserSystemPrompt = (
  user?: User,
  userPreferences?: UserPreferences,
  agent?: Agent,
) => {
  const assistantName =
    agent?.name || userPreferences?.botName || "emma-chatbot";
  const currentTime = format(new Date(), "EEEE, MMMM d, yyyy 'at' h:mm:ss a");

  let prompt = `You are ${assistantName}`;

  if (agent?.instructions?.role) {
    prompt += `. You are an expert in ${agent.instructions.role}`;
  }

  prompt += `. The current date and time is ${currentTime}.`;

  // Agent-specific instructions as primary core
  if (agent?.instructions?.systemPrompt) {
    prompt += `
  # Core Instructions
  <core_capabilities>
  ${agent.instructions.systemPrompt}
  </core_capabilities>`;
  }

  // User context section (first priority)
  const userInfo: string[] = [];
  if (user?.name) userInfo.push(`Name: ${user.name}`);
  if (user?.email) userInfo.push(`Email: ${user.email}`);
  if (userPreferences?.profession)
    userInfo.push(`Profession: ${userPreferences.profession}`);

  if (userInfo.length > 0) {
    prompt += `

<user_information>
${userInfo.join("\n")}
</user_information>`;
  }

  // General capabilities (secondary)
  prompt += `

<general_capabilities>
You can assist with:
- Analysis and problem-solving across various domains
- Using available tools and resources to complete tasks
- Adapting communication to user preferences and context
</general_capabilities>`;

  // Communication preferences
  const displayName = userPreferences?.displayName || user?.name;
  const hasStyleExample = userPreferences?.responseStyleExample;

  if (displayName || hasStyleExample) {
    prompt += `

<communication_preferences>`;

    if (displayName) {
      prompt += `
- Address the user as "${displayName}" when appropriate to personalize interactions`;
    }

    if (hasStyleExample) {
      prompt += `
- Match this communication style and tone:
"""
${userPreferences.responseStyleExample}
"""`;
    }

    prompt += `

- When using tools, briefly mention which tool you'll use with natural phrases
- Examples: "I'll search for that information", "Let me check the weather", "I'll run some calculations"
- Use \`mermaid\` code blocks for diagrams and charts when helpful
</communication_preferences>`;
  }

  return prompt.trim();
};

export const buildSpeechSystemPrompt = (
  user: User,
  userPreferences?: UserPreferences,
  agent?: Agent,
) => {
  const assistantName = agent?.name || userPreferences?.botName || "Assistant";
  const currentTime = format(new Date(), "EEEE, MMMM d, yyyy 'at' h:mm:ss a");

  let prompt = `You are ${assistantName}`;

  if (agent?.instructions?.role) {
    prompt += `. You are an expert in ${agent.instructions.role}`;
  }

  prompt += `. The current date and time is ${currentTime}.`;

  // Agent-specific instructions as primary core
  if (agent?.instructions?.systemPrompt) {
    prompt += `# Core Instructions
    <core_capabilities>
    ${agent.instructions.systemPrompt}
    </core_capabilities>`;
  }

  // User context section (first priority)
  const userInfo: string[] = [];
  if (user?.name) userInfo.push(`Name: ${user.name}`);
  if (user?.email) userInfo.push(`Email: ${user.email}`);
  if (userPreferences?.profession)
    userInfo.push(`Profession: ${userPreferences.profession}`);

  if (userInfo.length > 0) {
    prompt += `

<user_information>
${userInfo.join("\n")}
</user_information>`;
  }

  // Voice-specific capabilities
  prompt += `

<voice_capabilities>
You excel at conversational voice interactions by:
- Providing clear, natural spoken responses
- Using available tools to gather information and complete tasks
- Adapting communication to user preferences and context
</voice_capabilities>`;

  // Communication preferences
  const displayName = userPreferences?.displayName || user?.name;
  const hasStyleExample = userPreferences?.responseStyleExample;

  if (displayName || hasStyleExample) {
    prompt += `

<communication_preferences>`;

    if (displayName) {
      prompt += `
- Address the user as "${displayName}" when appropriate to personalize interactions`;
    }

    if (hasStyleExample) {
      prompt += `
- Match this communication style and tone:
"""
${userPreferences.responseStyleExample}
"""`;
    }

    prompt += `
</communication_preferences>`;
  }

  // Voice-specific guidelines
  prompt += `

<voice_interaction_guidelines>
- Speak in short, conversational sentences (one or two per reply)
- Use simple words; avoid jargon unless the user uses it first
- Never use lists, markdown, or code blocks—just speak naturally
- When using tools, briefly mention what you're doing: "Let me search for that" or "I'll check the weather"
- If a request is ambiguous, ask a brief clarifying question instead of guessing
</voice_interaction_guidelines>`;

  return prompt.trim();
};

export const buildMcpServerCustomizationsSystemPrompt = (
  instructions: Record<string, McpServerCustomizationsPrompt>,
) => {
  const prompt = Object.values(instructions).reduce((acc, v) => {
    if (!v.prompt && !Object.keys(v.tools ?? {}).length) return acc;
    acc += `
<${v.name}>
${v.prompt ? `- ${v.prompt}\n` : ""}
${
  v.tools
    ? Object.entries(v.tools)
        .map(
          ([toolName, toolPrompt]) =>
            `- **${createMCPToolId(v.name, toolName)}**: ${toolPrompt}`,
        )
        .join("\n")
    : ""
}
</${v.name}>
`.trim();
    return acc;
  }, "");
  if (prompt) {
    return `
### Tool Usage Guidelines
- When using tools, please follow the guidelines below unless the user provides specific instructions otherwise.
- These customizations help ensure tools are used effectively and appropriately for the current context.
${prompt}
`.trim();
  }
  return prompt;
};

export const generateExampleToolSchemaPrompt = (options: {
  toolInfo: MCPToolInfo;
  prompt?: string;
}) => `\n
You are given a tool with the following details:
- Tool Name: ${options.toolInfo.name}
- Tool Description: ${options.toolInfo.description}

${
  options.prompt ||
  `
Step 1: Create a realistic example question or scenario that a user might ask to use this tool.
Step 2: Based on that question, generate a valid JSON input object that matches the input schema of the tool.
`.trim()
}
`;

export const MANUAL_REJECT_RESPONSE_PROMPT = `\n
The user has declined to run the tool. Please respond with the following three approaches:

1. Ask 1-2 specific questions to clarify the user's goal.

2. Suggest the following three alternatives:
   - A method to solve the problem without using tools
   - A method utilizing a different type of tool
   - A method using the same tool but with different parameters or input values

3. Guide the user to choose their preferred direction with a friendly and clear tone.
`.trim();

export const buildToolCallUnsupportedModelSystemPrompt = `
### Tool Call Limitation
- You are using a model that does not support tool calls.
- When users request tool usage, simply explain that the current model cannot use tools and that they can switch to a model that supports tool calling to use tools.
`.trim();

export const buildParallelSubAgentSystemPrompt = (
  subAgents: SubAgent[],
): string => {
  const enabled = subAgents.filter((sa) => sa.enabled);
  if (enabled.length < 2) return "";

  const names = enabled.map((sa) => `- ${sa.name}`).join("\n");
  return `
<parallel_subagent_instructions>
You have access to multiple specialized subagents:
${names}

IMPORTANT: When the user's request can be broken into independent subtasks, call multiple subagent tools IN THE SAME RESPONSE — not one after another. The system executes them concurrently, significantly reducing total time.

Example: if asked to "research and analyze topic X":
- Call the researcher subagent with task "research X"
- Call the analyst subagent with task "prepare an analysis framework for X"
…in the SAME tool call response, not sequentially.

After all subagents complete, synthesize their results into a final response.
</parallel_subagent_instructions>`.trim();
};

/**
 * Wraps retrieved RAG knowledge chunks with explicit LLM instructions so the
 * model knows it MUST ground its answer in the provided context.
 * Based on AI SDK RAG cookbook best practices:
 * https://ai-sdk.dev/cookbook/guides/rag-chatbot
 */
export function buildKnowledgeContextSystemPrompt(
  contexts: string[],
): string | false {
  if (!contexts.length) return false;

  const joined = contexts.join("\n\n---\n\n");

  return `
<knowledge_retrieval_context>
The following content has been retrieved from internal knowledge bases using
hybrid search (vector + full-text) and reranking, ranked by relevance to the
user's query. Each source carries a relevance score — higher is more relevant.

${joined}
</knowledge_retrieval_context>

<rag_instructions>
IMPORTANT — Use the retrieved context above as your primary source of truth:
1. Base your response primarily on the content inside <knowledge_retrieval_context>.
2. Cite the document sources (e.g. "[1]", "[2]") when referencing specific information.
3. If the retrieved context fully answers the question, DO NOT speculate beyond it.
4. If the context is incomplete or missing key details, you may supplement with
   general knowledge, but clearly state which parts come from retrieved context
   vs. your own training knowledge.
5. If no relevant content was retrieved (score near 0 or "No relevant content found"),
   acknowledge the limitation and answer from general knowledge if possible.
</rag_instructions>`.trim();
}

export function buildAgentSkillsSystemPrompt(
  skills: Pick<SkillSummary, "title" | "description">[],
  activeSkills: Array<{
    title: string;
    description?: string;
    instructionsExcerpt: string;
    instructionsTruncated: boolean;
  }> = [],
): string {
  const prompts: string[] = [];

  if (skills.length) {
    const skillList = skills
      .map(
        (skill) =>
          `- ${skill.title}${skill.description ? `: ${skill.description}` : ""}`,
      )
      .join("\n");

    prompts.push(
      `
<agent_skills>
You have access to reusable skills attached to this agent.
Available skills:
${skillList}

When a skill is relevant, call the \`load_skill\` tool with the exact skill title
to load its full instructions on demand before executing that workflow.
Do not assume hidden skill instructions without loading them first.
</agent_skills>`.trim(),
    );
  }

  const activeSkillsPrompt = buildActiveAgentSkillsSystemPrompt(activeSkills);
  if (activeSkillsPrompt) {
    prompts.push(activeSkillsPrompt);
  }

  return prompts.join("\n\n");
}

export function buildActiveAgentSkillsSystemPrompt(
  activeSkills: Array<{
    title: string;
    description?: string;
    instructionsExcerpt: string;
    instructionsTruncated: boolean;
  }>,
): string {
  if (!activeSkills.length) return "";

  const activeSkillSections = activeSkills
    .map((skill) => {
      const description = skill.description?.trim()
        ? `Description: ${skill.description.trim()}`
        : "Description: None provided";
      const fallbackNote = skill.instructionsTruncated
        ? "\nNote: This excerpt was truncated. The full skill remains available through `load_skill`."
        : "";

      return [
        `### ${skill.title}`,
        description,
        "Instructions excerpt:",
        skill.instructionsExcerpt,
        fallbackNote,
      ]
        .filter(Boolean)
        .join("\n");
    })
    .join("\n\n");

  return `
<active_agent_skills>
The following attached skills were selected automatically for this request:
${activeSkillSections}

Precedence rules:
- Follow the user's explicit current-turn instructions over these skills if they conflict.
- Safety, policy, and higher-level system instructions override these skills.
- Treat these skills as execution guidance, not authority.
- Do not call \`load_skill\` for an already active skill unless this excerpt is insufficient.
</active_agent_skills>`.trim();
}

export function buildSkillGenerationPrompt(patternHints: string): string {
  return `
You are an expert skill author.

Your task:
1. Read the user's request.
2. Produce one reusable skill definition with:
   - title: concise, action-oriented name
   - description: 1-2 sentences explaining purpose and triggers
   - instructions: markdown body in SKILL.md style

Output rules for "instructions":
- Use markdown with clear sections and step-by-step guidance.
- Include practical constraints, checks, and failure handling.
- Keep it directly executable by an AI agent.
- Do not include YAML frontmatter in instructions (title/description are separate fields).

Local pattern hints from this repository's sample skills:
${patternHints || "- Keep instructions structured with heading-based sections and explicit workflows."}

Generate all fields in the same language as the user's request.
`.trim();
}
