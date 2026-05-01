// Payloads de los endpoints internos del platform y driver app.

import type { ReportType, IncidentDetail, TicketData, ResolutionType } from '../domain/report';
import type { EvidenceKey } from '../flow/steps';

export interface CreateRouteRequest {
  name: string;
  date: string;
  vehicleIds: string[];
  stopIds: string[];
}

export interface CreateRouteResponse {
  id: string;
  status: 'DRAFT';
}

export interface OptimizeRouteResponse {
  id: string;
  status: 'OPTIMIZED';
  totalDistanceMeters: number;
  totalDurationSeconds: number;
  unassignedStopIds: string[];
}

export interface ReportStopRequest {
  type: ReportType;
  evidence: Partial<Record<EvidenceKey, string>>;
  ticketData?: TicketData;
  incidentDetails?: IncidentDetail[];
  noTicketReason?: string;
  otherIncidentDescription?: string;
}

export interface ReportStopResponse {
  id: string;
  status: 'submitted';
}

export interface ResolveReportRequest {
  resolutionType: ResolutionType;
  partialFailureItems?: IncidentDetail[];
}
