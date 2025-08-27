"use client";
import Image from "next/image";
import Logo from "../../../public/prism-logo-bg-removed.png";
import Link from "next/link";
import { usePathname } from "next/navigation";

const Header = () => {
  const pathname = usePathname();

  return (
    <header className="w-screen bg-[var(--color-bg-secondary)] flex flex-col">
      <div className="px-4 flex items-center">
        <Link
          href={"/"}
          className="flex items-center gap-x-4 text-[var(--color-text-primary)]"
        >
          <Image src={Logo} alt={"tsa-logo"} height={64} priority={true} />{" "}
          <span className="text-2xl font-semibold tracking-wide bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
            PRISM
          </span>
        </Link>

        <div className="ml-auto">
          {pathname === "/insights" ? (
            <Link href={"/"}>
              <button className="px-3 py-1.5 text-sm border-none rounded-md bg-black/60 text-[var(--color-text-primary)] min-w-[150px] cursor-pointer hover:bg-black/20 transition-colors">
                <span className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
                  View Call Logs
                </span>
              </button>
            </Link>
          ) : (
            <Link href={"/insights"}>
              <button className="px-3 py-1.5 text-sm border-none rounded-md bg-black/60 text-[var(--color-text-primary)] min-w-[150px] cursor-pointer hover:bg-black/20 transition-colors">
                <span className="bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)] bg-clip-text text-transparent">
                  View Insights
                </span>
              </button>
            </Link>
          )}
        </div>
      </div>

      <div className="h-[1px] w-[100vw] bg-gradient-to-r from-[var(--color-prism-blue)] to-[var(--color-prism-orange)]" />
    </header>
  );
};

export default Header;
