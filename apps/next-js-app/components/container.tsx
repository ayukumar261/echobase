import * as React from "react"

import { cn } from "@/lib/utils"

function Container({
  className,
  ...props
}: React.ComponentProps<"div">) {
  return (
    <div
      data-slot="container"
      className={cn(
        "mx-auto w-full px-4 sm:px-6 lg:px-8",
        "max-w-screen-sm md:max-w-screen-md lg:max-w-screen-lg xl:max-w-screen-xl 2xl:max-w-screen-2xl",
        className,
      )}
      {...props}
    />
  )
}

export { Container }
