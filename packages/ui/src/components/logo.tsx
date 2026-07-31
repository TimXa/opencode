import { type ComponentProps } from "solid-js"

export const Mark = (props: { class?: string }) => {
  return (
    <svg
      data-component="logo-mark"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M50 125V35L75 62.5M150 125V35L125 62.5M25 87.5L100 50L175 87.5M50 125L100 150L150 125" stroke="var(--icon-strong-base)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M75 95V108M125 95V108" stroke="var(--icon-strong-base)" stroke-width="8" stroke-linecap="round" />
      <path d="M94 116H106L100 123Z" fill="#C18C5D" stroke="#C18C5D" stroke-width="5" stroke-linejoin="round" />
    </svg>
  )
}

export const Splash = (props: Pick<ComponentProps<"svg">, "ref" | "class">) => {
  return (
    <svg
      ref={props.ref}
      data-component="logo-splash"
      classList={{ [props.class ?? ""]: !!props.class }}
      viewBox="0 0 200 200"
      fill="none"
      xmlns="http://www.w3.org/2000/svg"
    >
      <path d="M50 125V35L75 62.5M150 125V35L125 62.5M25 87.5L100 50L175 87.5M50 125L100 150L150 125" stroke="var(--icon-strong-base)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
      <path d="M75 95V108M125 95V108" stroke="var(--icon-strong-base)" stroke-width="8" stroke-linecap="round" />
      <path d="M94 116H106L100 123Z" fill="#C18C5D" />
    </svg>
  )
}

export const Logo = (props: { class?: string }) => {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox="0 0 260 90"
      fill="none"
      classList={{ [props.class ?? ""]: !!props.class }}
    >
      <g transform="translate(4 -4) scale(.48)">
        <path d="M50 125V35L75 62.5M150 125V35L125 62.5M25 87.5L100 50L175 87.5M50 125L100 150L150 125" stroke="var(--icon-strong-base)" stroke-width="8" stroke-linecap="round" stroke-linejoin="round" />
        <path d="M75 95V108M125 95V108" stroke="var(--icon-strong-base)" stroke-width="8" stroke-linecap="round" />
        <path d="M94 116H106L100 123Z" fill="#C18C5D" />
      </g>
      <text x="108" y="61" fill="var(--icon-strong-base)" font-size="54" font-weight="650" font-family="system-ui, sans-serif">Кит</text>
    </svg>
  )
}
