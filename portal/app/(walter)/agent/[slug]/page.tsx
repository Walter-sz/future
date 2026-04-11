import { notFound } from "next/navigation";
import { getAgentBySlug } from "@/hub/agents";
import { WalterPlaceholderPage } from "@/hub/placeholder-page";

type Props = { params: Promise<{ slug: string }> };

export default async function AgentConsolePage({ params }: Props) {
  const { slug } = await params;
  const agent = getAgentBySlug(slug);
  if (!agent) notFound();

  return (
    <WalterPlaceholderPage
      title={agent.title}
      description={`${agent.description} 控制台与编排能力后续在此扩展。`}
    />
  );
}
