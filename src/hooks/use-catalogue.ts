import { useQuery } from '@tanstack/react-query';
import { apiGet, apiGetAgent } from '@/lib/api';
import type { MCPToolsResponse, SkillsResponse } from '@/lib/api';

// Tools and skills rarely change, so keep them fresh for 5 minutes and skip
// the default window-focus refetch — this is a browse-only catalogue.
const STALE_TIME = 5 * 60 * 1000;

// MCP tools live on the agent role (see the role split in lib/api.ts).
export function useMcpTools(enabled = true) {
  return useQuery({
    queryKey: ['mcp-tools'],
    queryFn: () => apiGetAgent<MCPToolsResponse>('/api/v1/mcp/tools'),
    enabled,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  });
}

export function useSkills(enabled = true) {
  return useQuery({
    queryKey: ['skills'],
    queryFn: () => apiGet<SkillsResponse>('/api/v1/skills'),
    enabled,
    staleTime: STALE_TIME,
    refetchOnWindowFocus: false,
  });
}
