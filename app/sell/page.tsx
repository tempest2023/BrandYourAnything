import type { Metadata } from "next";

import { CreateLaptopForm } from "../create/create-laptop-form";

export const metadata: Metadata = {
  title: "Put your lid up — BrandMyLaptop",
  description: "Set your machine, your prices, and publish your laptop lid for brands.",
};

export default function SellLaptopPage() {
  return <CreateLaptopForm />;
}
