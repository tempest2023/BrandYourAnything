import type { Metadata } from "next";

import { CreateLaptopForm } from "./create-laptop-form";

export const metadata: Metadata = {
  title: "List your laptop — Brand Anything",
  description: "Create a public sponsorship auction for the lid of your own laptop.",
};

export default function CreateLaptopPage() {
  return <CreateLaptopForm />;
}
