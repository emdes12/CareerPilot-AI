export interface RawJob {
  source: string;
  sourceJobId: string;
  sourceUrl: string;
  title: string;
  company: string;
  companyWebsite?: string | null;
  postedAt?: Date | null;
  deadline?: Date | null;
  descriptionHtml?: string | null;
  descriptionText?: string | null;
  locationRaw?: string | null;
  locationRestrictions?: string[];
  timezoneRestrictions?: number[];
  employmentType?: string | null;
  seniority?: string | null;
  salaryRaw?: string | null;
  salaryMin?: number | null;
  salaryMax?: number | null;
  salaryCurrency?: string | null;
  salaryPeriod?: 'year' | 'month' | 'hour' | null;
  tags?: string[];
  applyUrl?: string | null;
  ats?: string | null;
  raw?: unknown;
}

export interface Board { ats: 'greenhouse' | 'lever' | 'ashby' | 'workable'; slug: string; company: string }

export interface SourceContext {
  keywords: string[];
  boards: Board[];
  maxAgeDays: number;
  log: (msg: string) => void;
}

export interface JobSource {
  id: string;
  name: string;
  kind: 'aggregator' | 'ats' | 'unsupported';
  access: string;          // how we access it, for transparency
  available: boolean;
  unavailableReason?: string;
  fetch(ctx: SourceContext): Promise<RawJob[]>;
}
