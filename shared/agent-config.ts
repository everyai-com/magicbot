export const AGENT_CONFIG_TEXT_LIMIT = 4000;

export interface AgentProfileConfig {
  voices?: string;
  knowledgeBase?: string;
  aiProvider?: string;
  model?: string;
  firstSpeaker?: "agent" | "caller";
  temperature?: number;
  language?: string;
  maxDuration?: number;
  callForwarding?: string;
  phoneNumberId?: string;
  phoneNumber?: string;
  knowledgeBaseIds?: string;
  knowledgeBaseCorpusMap?: string;
  appointmentTools?: string;
  customTools?: string;
  customCrm?: string;
  webhooks?: string;
}
