import CallLogTable from "../components/ui/CallLogTable";

export default function Home() {
  return (
    <div className="flex-1 flex flex-col">
      <div className="flex-1 p-4 flex flex-col">
        <CallLogTable />
      </div>
    </div>
  );
}
