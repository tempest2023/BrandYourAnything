import type { Metadata } from "next";

import { CreateLaptopForm } from "./create-laptop-form";

export const metadata: Metadata = {
  title: "Put your lid up — Brand Anything",
  description: "Set your machine, your prices, and publish your laptop lid for brands.",
};

export default function CreateLaptopPage() {
  return <CreateLaptopForm />;
}
