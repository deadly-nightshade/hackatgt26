import MeetScene from "./MeetScene";

export default async function MeetPage({ params }: { params: Promise<{ targetId: string }> }) {
  const { targetId } = await params;
  return <MeetScene targetId={decodeURIComponent(targetId)} />;
}
