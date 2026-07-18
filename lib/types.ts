export type Scene = "startup" | "love";

export type Intent = {
  title: string;
  summary: string;
  scene: Scene;
  target: string;
  context?: string;
  offer: string;
  commitment?: string;
  constraints?: string;
  validity: string;
  status?: "draft" | "active" | "paused";
};

export type QuestionOption = {
  value: string;
  label: string;
  description?: string;
};

export type AgentQuestion = {
  id: string;
  label: string;
  type: "single_choice" | "multi_choice" | "short_text";
  options?: QuestionOption[];
  placeholder?: string;
  required?: boolean;
  allowOther?: boolean;
};

export type QuestionAnswers = Record<string, string | string[]>;

export type AgentQuestionForm = {
  toolCallId: string;
  title: string;
  description?: string;
  progress: number;
  questions: AgentQuestion[];
  submitLabel?: string;
  status?: "pending" | "submitted";
  answers?: QuestionAnswers;
};

export type ChatMessage = {
  id: string;
  role: "user" | "assistant";
  content: string;
  questionForm?: AgentQuestionForm;
};

export type Opportunity = {
  id: string;
  scene: Scene;
  type: string;
  title: string;
  summary: string;
  description: string;
  tags: string[];
  members: number;
  minMembers: number;
  maxMembers: number;
  deadline: string;
  reason: string;
  observation: string;
  people: Array<{ name: string; summary: string; offer: string }>;
};

export type Profile = {
  nickname: string;
  email: string;
  city: string;
  identity: string;
  skills: string;
  offer: string;
  bio: string;
};
