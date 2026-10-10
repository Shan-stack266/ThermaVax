export default function FormMessage({ children }) {
  return children ? <div className="form-message error full-width">{children}</div> : null;
}
