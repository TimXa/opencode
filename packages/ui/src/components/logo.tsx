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

export const KitOrbit = (props: { class?: string }) => {
  return (
    <svg class={props.class} data-component="kit-orbit" viewBox="0 0 300 300" fill="none" aria-hidden="true">
      <defs>
        <path id="kit-orbit-path" d="M260 150a110 35 0 0 1-220 0 110 35 0 0 1 220 0" />
        <g id="kit-orbit-file">
          <path d="M-12-16H4l8 8v24h-24z" fill="var(--kit-orbit-page)" stroke="currentColor" stroke-width="4" stroke-linejoin="round" />
          <path d="M4-16v8h8" stroke="currentColor" stroke-width="4" stroke-linejoin="round" />
        </g>
        <clipPath id="kit-orbit-top"><rect width="300" height="150" /></clipPath>
        <mask id="kit-orbit-mask">
          <rect width="300" height="300" fill="white" />
          <g clip-path="url(#kit-orbit-top)" fill="black" stroke="black" stroke-width="9" stroke-linejoin="round">
            <path d="M100 112.5v62.5l50 25 50-25v-62.5" />
            <path d="m75 137.5 75-37.5 75 37.5" />
          </g>
        </mask>
      </defs>
      <g class="kit-orbit-body">
        <path class="kit-orbit-contour" d="M100 175V85l25 27.5M200 175V85l-25 27.5M75 137.5 150 100l75 37.5M100 175l50 25 50-25" />
        <g class="kit-orbit-eyes">
          <path class="kit-orbit-contour kit-orbit-blink" d="M125 145v13M175 145v13" />
        </g>
        <path class="kit-orbit-nose" d="m144 166h12l-6 7z" />
      </g>
      <g mask="url(#kit-orbit-mask)">
        <use href="#kit-orbit-path" class="kit-orbit-trail" />
        <g class="kit-orbit-file kit-orbit-file-one"><use href="#kit-orbit-file" /></g>
        <g class="kit-orbit-file kit-orbit-file-two"><use href="#kit-orbit-file" /></g>
        <g class="kit-orbit-file kit-orbit-file-three"><use href="#kit-orbit-file" /></g>
      </g>
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
