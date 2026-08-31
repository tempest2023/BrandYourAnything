import type { Metadata } from "next";

import { CreateLaptopForm } from "./create-laptop-form";

export const metadata: Metadata = {
  title: "Brand your anything — Brand Anything",
  description: "Upload a 3D model or build one from a photo with img2threejs, then publish a live sponsorship auction.",
};

export default function CreateLaptopPage() {
  return <CreateLaptopForm />;
}
