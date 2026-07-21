export type Scene = "startup" | "love";

export type Channel = "founder" | "play" | "love" | "jobs" | "capital" | "travel";

export type RoomLifecycleStatus =
  | "recruiting"
  | "pending_confirmation"
  | "formed"
  | "scheduled"
  | "in_progress"
  | "completed"
  | "cancelled"
  | "follow_up";

export type TrustSummary = {
  emailVerified: boolean;
  phoneVerified: boolean;
  workVerified: boolean;
  hostVerified: boolean;
  realNameVerified: boolean;
  institutionVerified: boolean;
  creditScore: number;
  completedRooms: number;
  noShowCount: number;
  reportCount: number;
};

export type MatchInsight = {
  score: number;
  verdict: "strong" | "possible" | "explore";
  headline: string;
  reasons: string[];
  complements: string[];
  constraints: string[];
  nextStep: string;
  source: "agent" | "local";
};

export type Intent = {
  title: string;
  summary: string;
  scene: Scene;
  channel?: Channel;
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
  channel?: Channel;
  type: string;
  title: string;
  summary: string;
  description: string;
  tags: string[];
  members: number;
  minMembers: number;
  maxMembers: number;
  startsAt: string;
  endsAt: string;
  registrationDeadline: string;
  cancellationDeadline: string;
  city: string;
  venue: string;
  address: string;
  distanceKm?: number;
  price: {
    type: "free" | "aa" | "fixed";
    amount?: number;
    note?: string;
  };
  organizer: {
    name: string;
    role: string;
    verified?: boolean;
  };
  registrationMode: "instant" | "approval";
  visibility?: "public" | "invite_only";
  lifecycleStatus?: RoomLifecycleStatus;
  spaceLabel?: string;
  joinChannel?: {
    type: "wecom" | "wechat" | "none";
    label: string;
    href?: string;
    instructions?: string;
  };
  agenda: string[];
  notices: string[];
  reason: string;
  observation: string;
  matchInsight?: MatchInsight;
  trialPlan?: {
    objective: string;
    roles: string[];
    deadline: string;
    completionCriteria: string;
    continuationDecision?: string;
  };
  people: Array<{
    name: string;
    summary: string;
    offer: string;
    need?: string;
    role?: string;
  }>;
};

export type OpportunityRegistrationStatus = "pending" | "confirmed" | "waitlisted";

export type OpportunityRegistration = {
  opportunityId: string;
  status: OpportunityRegistrationStatus;
  note: string;
  joinedAt: string;
};

export type OpportunityWithRegistration = Opportunity & {
  registration?: OpportunityRegistration;
  isHost?: boolean;
};

export type RoomMessage = {
  id: string;
  eventId: string;
  userId: string;
  author: string;
  avatar: string;
  content: string;
  createdAt: string;
};

export type RoomState = {
  eventId: string;
  status: RoomLifecycleStatus;
  scheduledAt?: string;
  location?: string;
  meetingUrl?: string;
  objective?: string;
  roles: string[];
  deadline?: string;
  completionCriteria?: string;
  continuationDecision?: string;
  updatedAt: string;
};

export type RoomFeedback = {
  eventId: string;
  attended: boolean;
  outcome: "completed" | "partial" | "not_started";
  continueInterest: "yes" | "maybe" | "no";
  rating: number;
  notes: string;
  createdAt: string;
};

export type RoomMember = {
  userId: string;
  name: string;
  avatar: string;
  identity: string;
  summary: string;
  offer: string;
  joinedAt: string;
  isHost: boolean;
};

export type RoomApplication = {
  id: string;
  userId: string;
  name: string;
  avatar: string;
  note: string;
  status: OpportunityRegistrationStatus;
  joinedAt: string;
};

export type RoomCoordination = {
  pendingCount: number;
  waitlistCount: number;
  nextAction: string;
  reminder: string;
  nextRelationshipSuggestion: string;
};

export type RoomWorkspace = {
  currentUserId: string;
  state: RoomState;
  messages: RoomMessage[];
  members: RoomMember[];
  applications: RoomApplication[];
  coordination: RoomCoordination;
  feedback?: RoomFeedback;
  trust: TrustSummary;
  canManage: boolean;
  canChat: boolean;
};

export type Profile = {
  nickname: string;
  email: string;
  avatar: string;
  city: string;
  identity: string;
  skills: string;
  offer: string;
  bio: string;
  wechat: string;
  trust?: TrustSummary;
};

export type EventGuest = {
  id: string;
  name: string;
  tagline: string;
  roles: string[];
  company: string;
  stage: string;
  position: string;
  needs: string[];
  needDetail: string;
  offers: string[];
  offerDetail: string;
  sourceRow?: number;
};

export type EventMatch = {
  id: string;
  requesterId: string;
  providerId: string;
  strength: 1 | 2 | 3;
  dimensions: string[];
  reason: string;
  opening: string;
  mutual: boolean;
};
