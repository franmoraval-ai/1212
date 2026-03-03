'use server';
/**
 * @fileOverview An AI agent for prioritizing security incidents.
 *
 * - prioritizeIncident - A function that handles the incident prioritization process.
 * - IncidentPrioritizationInput - The input type for the prioritizeIncident function.
 * - IncidentPrioritizationOutput - The return type for the prioritizeIncident function.
 */

import { ai } from '@/ai/genkit';
import { z } from 'genkit';

const IncidentPrioritizationInputSchema = z.object({
  description: z.string().describe('Detailed description of the incident.'),
  incidentType: z.string().describe('The type of incident (e.g., "theft", "vandalism", "unauthorized access", "fire alarm").'),
  location: z.string().describe('The location where the incident occurred.'),
  time: z.string().describe('The time the incident occurred, in a human-readable format.'),
  historicalContext: z.string().optional().describe('Any relevant historical data or similar past incidents that might influence prioritization. Can be an empty string if no context is available.'),
});
export type IncidentPrioritizationInput = z.infer<typeof IncidentPrioritizationInputSchema>;

const IncidentPrioritizationOutputSchema = z.object({
  priorityLevel: z.enum(['Low', 'Medium', 'High', 'Critical']).describe('The suggested priority level for the incident.'),
  reasoning: z.string().describe('The justification for the suggested priority level, explaining the factors considered.'),
});
export type IncidentPrioritizationOutput = z.infer<typeof IncidentPrioritizationOutputSchema>;

export async function prioritizeIncident(input: IncidentPrioritizationInput): Promise<IncidentPrioritizationOutput> {
  return aiIncidentPrioritizationFlow(input);
}

const prompt = ai.definePrompt({
  name: 'aiIncidentPrioritizationPrompt',
  input: { schema: IncidentPrioritizationInputSchema },
  output: { schema: IncidentPrioritizationOutputSchema },
  prompt: `You are an AI-powered incident prioritization tool for SecuraWatch, a security operations platform.
Your task is to analyze new security incident reports and suggest a priority level based on the provided details and an understanding of typical security operations.

Consider the following factors when determining priority:
- The nature of the incident (e.g., severity, potential for harm, type of crime).
- The location of the incident (e.g., critical infrastructure, high-traffic area, remote).
- The time of the incident.
- Any provided historical context or similar past events.

Assign one of the following priority levels: 'Low', 'Medium', 'High', 'Critical'.
Provide a clear and concise reasoning for your decision.

Incident Details:
Description: {{{description}}}
Incident Type: {{{incidentType}}}
Location: {{{location}}}
Time: {{{time}}}
Historical Context: {{{historicalContext}}}`,
});

const aiIncidentPrioritizationFlow = ai.defineFlow(
  {
    name: 'aiIncidentPrioritizationFlow',
    inputSchema: IncidentPrioritizationInputSchema,
    outputSchema: IncidentPrioritizationOutputSchema,
  },
  async (input) => {
    const { output } = await prompt(input);
    return output!;
  }
);
