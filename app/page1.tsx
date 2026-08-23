import Image from "next/image";

export default function Home() {
  return (
    <div className="d-flex align-items-center justify-content-center my-5" style={{height: '80vh'}}>
      <a href="/admin" className="px-4">
        <h3>Admin</h3>
      </a>
      <a href="/dealer" className="px-4">
        <h3>Dealer</h3>
      </a>
      <a href="/agency" className="px-4">
        <h3>Agency</h3>
      </a>
    </div>
  );
}
