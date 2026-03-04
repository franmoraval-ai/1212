/**
 * Tipos para documentos de Firestore - HO Seguridad
 */

export interface FirestoreIncident {
  id?: string
  description: string
  incidentType: string
  location: string
  time: { toDate: () => Date }
  priorityLevel?: 'Critical' | 'High' | 'Medium' | 'Low'
  reasoning?: string
  reportedBy?: string
}

export interface FirestoreSupervision {
  id?: string
  operationName: string
  officerName: string
  type: string
  idNumber?: string
  weaponModel?: string
  weaponSerial?: string
  reviewPost: string
  gps?: { lat: number; lng: number } | null
  checklist: Record<string, boolean>
  checklistReasons?: Record<string, string>
  observations?: string
  status?: string
  photos?: string[]
  createdAt?: { toDate: () => Date }
}

export interface FirestoreManagementAudit {
  id?: string
  operationName: string
  officerName?: string
  officerId?: string
  postName?: string
  officerEvaluation?: Record<string, boolean>
  postEvaluation?: Record<string, boolean>
  administrativeCompliance?: {
    billingCorrect: boolean
    rosterUpdated: boolean
    documentationInPlace: boolean
  }
  findings?: string
  actionPlan?: string
  managerId?: string
  createdAt?: { toDate: () => Date }
}

export interface FirestoreWeapon {
  id?: string
  model: string
  serial: string
  type: string
  status: string
  assignedTo?: string
  location?: { lat: number; lng: number }
  lastCheck?: { toDate: () => Date }
}

export interface FirestoreUser {
  id?: string
  firstName?: string
  email: string
  role_level: number
  status: string
  assigned?: string
  createdAt?: string
}

export interface FirestoreRound {
  id?: string
  name: string
  post: string
  status: string
  frequency?: string
  lng?: number
  lat?: number
  checkpoints?: { name: string; lat: number; lng: number }[]
}

export interface FirestoreAlert {
  id?: string
  type: string
  userId: string
  userEmail?: string
  location?: { lat: number; lng: number }
  createdAt?: { toDate: () => Date }
}

export interface FirestoreVisitor {
  id?: string
  name: string
  documentId?: string | null
  visitedPerson?: string | null
  entryTime?: { toDate: () => Date }
  exitTime?: { toDate: () => Date } | null
}
