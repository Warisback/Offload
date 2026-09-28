// The backend contract, exactly. Money is always integer pence. Ids are short strings. Photos are public URLs.

export type Pence = number;

export type PickupStatus = 'estimated' | 'booked' | 'collected' | 'listed';
export interface PreviewLine {
  label: string;
  low: Pence;
  high: Pence;
}
export interface Pickup {
  id: string;
  seller_name: string;
  address: string;
  transcript: string;
  estimate_low: Pence;
  estimate_high: Pence;
  preview: PreviewLine[];
  status: PickupStatus;
  runner_name: string | null;
  created_at: string;
}

export type Grade = 'A' | 'B' | 'C' | 'D';
export type ItemStatus = 'estimated' | 'needs_photos' | 'photographed' | 'listed' | 'offer' | 'sold' | 'posted';
export type PriceSource = 'comps' | 'seller' | 'table';
export type Confidence = 'high' | 'medium' | 'low';
export interface Comp {
  source: string;
  title: string;
  price: Pence;
  url: string;
}
export interface Item {
  id: string;
  pickup_id: string;
  label: string;
  brand: string | null;
  type: string;
  size: string | null;
  grade: Grade | null;
  condition_notes: string[];
  special: string | null;
  claim: string | null;
  claim_proof: string | null;
  seller_ask: Pence | null;
  price_source: PriceSource;
  price_confidence: Confidence;
  seller_story: string | null;
  photo_requests: string[];
  proof_request: string | null;
  seller_proof: string[];
  photos: string[];
  comps: Comp[];
  list_price: Pence;
  floor_price: Pence;
  shopify_url: string | null;
  status: ItemStatus;
}

export type JobType = 'pickup' | 'post';
export type JobStatus = 'open' | 'accepted' | 'done';
export interface Job {
  id: string;
  type: JobType;
  pickup_id: string;
  item_ids: string[];
  runner_name: string | null;
  address: string;
  pay: Pence;
  status: JobStatus;
}

export type OfferStatus = 'pending' | 'accepted' | 'countered' | 'rejected';
export interface Offer {
  id: string;
  item_id: string;
  buyer: string;
  amount: Pence;
  counter: Pence | null;
  round: 1 | 2;
  status: OfferStatus;
  discount_code: string | null;
}

export interface Ledger {
  id: string;
  item_id: string;
  sale_price: Pence;
  seller_amount: Pence;
  runner_amount: Pence;
  our_amount: Pence;
}

export type Actor = 'agent' | 'seller' | 'runner' | 'buyer';
export interface FeedEvent {
  id: string;
  ts: string;
  actor: Actor;
  text: string;
  money: Pence | null;
}

export interface AppState {
  pickups: Pickup[];
  items: Item[];
  jobs: Job[];
  offers: Offer[];
  ledger: Ledger[];
  events: FeedEvent[];
}

export type DemoStep = 'estimate' | 'photos' | 'sale' | 'reset';

// POST /api/live/frame only ever answers with one of these.
export const LIVE_PROMPTS = [
  'Show me the label',
  'Turn it round',
  'Any marks or damage?',
  'Show the size tag',
  'Anything special about it?',
  'What would you want for this one?',
  'Show me the signature or the change up close',
  'Hold it up flat',
  'Got it, next item',
  'Looks good, you can stop',
] as const;
export type LivePrompt = (typeof LIVE_PROMPTS)[number];
export interface LiveFrameReply {
  prompt: LivePrompt;
  notes: string;
}

// Money split per sale (display only; the backend's ledger is the truth).
export const SELLER_SHARE = 0.7;
export const RUNNER_FEE: Pence = 600;
