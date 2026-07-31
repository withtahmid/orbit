import { Toaster as Sonner, type ToasterProps } from "sonner";
import { Check, Info, TriangleAlert, X } from "lucide-react";

/**
 * The app's single toast surface. Visual design lives in
 * styles/orbit-toast.css — see the header comment there before editing.
 *
 * Configuration decisions worth keeping:
 *
 * - `top-center`. The New/Edit transaction drawers pin "Save & add another"
 *   / "Save transaction" to the bottom-right of the panel, and failure
 *   toasts use `duration: Infinity`, so a bottom-anchored toast sat on top
 *   of those buttons and blocked back-to-back entry. Top also survives the
 *   mobile case, where the drawer is full-width with the same bottom footer.
 * - Custom `icons`. Each variant gets a distinct lucide glyph, so meaning
 *   never rests on colour alone. sonner's stock icons ship their own
 *   filled-circle art, which clashes with the app's stroke icon language.
 * - Swipe in three directions. On touch that's the primary dismissal; the
 *   close button is the pointer/keyboard path.
 */
const Toaster = ({ ...props }: ToasterProps) => {
    return (
        <Sonner
            theme="dark"
            className="orbit-toaster"
            position="top-center"
            closeButton
            duration={4200}
            gap={10}
            visibleToasts={4}
            offset={{ top: 18 }}
            mobileOffset={{
                top: "calc(env(safe-area-inset-top, 0px) + 10px)",
                left: 12,
                right: 12,
            }}
            swipeDirections={["top", "left", "right"]}
            /* sonner writes --width inline from its own 356px constant, so
               this is the only place it can be widened. Financial messages
               ("Expense of 1,200 didn't save — …") need the extra room. */
            style={{ "--width": "380px" } as ToasterProps["style"]}
            icons={{
                success: <Check aria-hidden />,
                error: <X aria-hidden />,
                warning: <TriangleAlert aria-hidden />,
                info: <Info aria-hidden />,
                loading: <span className="ot-spinner" aria-hidden />,
                close: <X aria-hidden />,
            }}
            {...props}
        />
    );
};

export { Toaster };
