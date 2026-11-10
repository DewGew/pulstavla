import { useState, useEffect } from "react";
import { apiFetch } from "../api";
import { API_URL } from "../config";
import "./Profile.css";

/* ================= ÖVERSÄTTNINGAR ================= */
const T = {
  sv: {
    title: "Min profil",
    username: "Användarnamn:",
    role: "Roll:",
    roleLabels: {
      admin: "Admin",
      view: "Viewer",
      suAdmin: "Super Admin",
      user: "Användare",
    },
    name: "Namn:",
    email: "E-post:",
    password: "Lösenord:",
    passwordPlaceholder: "Nytt lösenord (valfritt)",
    updateButton: "Uppdatera profil",
    updating: "Uppdaterar...",
    sendMessageTitle: "Skicka meddelande via Teams",
    selectUser: "Välj användare…",
    openTeams: "Öppna Teams-chatt",
    noEmailWarning:
      "Lägg till en giltig e-postadress för att kunna skicka Teams-meddelanden.",
    myActivities: "Mina aktiviteter",
    showDone: "Visa klara",
    hideDone: "Dölj klara",
    doneTag: " ✔ klar",
    goToActivities: "Gå till aktiviteter",
    noActivities: "Inga aktiviteter att visa",
    profileUpdated: "✔️ Profil uppdaterad!",
    profileError: (err) => `❌ Fel: ${err}`,
    connectionError: "❌ Kunde inte ansluta till servern.",
    privacyTitle: "Integritetspolicy för Pulstavla",
    privacyP1: (
      <>
        Kontakta gärna oss via e-mail på <strong>info@kapima.se</strong> eller{" "}
        <strong>administratören</strong> om du behöver någon mer information
        eller har frågor om pulstavlans integritetspolicy, eller om du vill
        att någon personlig information som vi har lagrat ska tas bort.
      </>
    ),
    privacyP2:
      "Du kan också kontakta oss på samma email om vill begära tillgång till vilken data vi lagrat eller om du vill rätta någon data som vi har lagrat.",
    privacyP3:
      "Integriteten för dig som användare av pulstavlan är väldigt viktig. Det här dokumentet beskriver de olika typer av personlig information som ges och samlas in av kapima.se, och hur denna informationen används.",
    cookiesQuestion: "Använder sig pulstavlan av cookies?",
    cookiesP1:
      "Ja, pulstavlan använder sig av standard cookies. Cookies är textfiler som lagras i besökarens webbläsare (i samband med exempelvis besök av en hemsida via en dator eller mobiltelefon). Cookies används framförallt för att förbättra hemsidors funktionalitet. Cookies sparas i anslutning till de filer som används av datorns webbläsare eller motsvarande program.",
    cookiesP2:
      "Om du vill förhindra att din dator sparar dessa cookies så går det att undvika genom att ställa in det i inställningarna i din webbläsare. Du går in under inställningar och säkerhet i din webbläsare och väljer att cookies inte ska tillåtas. Det är dock rekommenderat att du har cookies påslagna i din webbläsare. Det gör att din upplevelse av pulstavlan blir bättre.",
  },
  en: {
    title: "My Profile",
    username: "Username:",
    role: "Role:",
    roleLabels: {
      admin: "Admin",
      view: "Viewer",
      suAdmin: "Super Admin",
      user: "User",
    },
    name: "Name:",
    email: "Email:",
    password: "Password:",
    passwordPlaceholder: "New password (optional)",
    updateButton: "Update profile",
    updating: "Updating...",
    sendMessageTitle: "Send message via Teams",
    selectUser: "Select user…",
    openTeams: "Open Teams chat",
    noEmailWarning:
      "Add a valid email address to be able to send Teams messages.",
    myActivities: "My activities",
    showDone: "Show completed",
    hideDone: "Hide completed",
    doneTag: " ✔ done",
    goToActivities: "Go to activities",
    noActivities: "No activities to show",
    profileUpdated: "✔️ Profile updated!",
    profileError: (err) => `❌ Error: ${err}`,
    connectionError: "❌ Could not connect to the server.",
    privacyTitle: "Privacy Policy for Pulstavla",
    privacyP1: (
      <>
        Feel free to contact us via email at <strong>info@kapima.se</strong>{" "}
        or the <strong>administrator</strong> if you need more information
        or have questions about the dashboard's privacy policy, or if you
        want any personal information we have stored to be removed.
      </>
    ),
    privacyP2:
      "You can also contact us at the same email if you want to request access to the data we have stored, or if you want to correct any data we have stored.",
    privacyP3:
      "The privacy of you as a user of the dashboard is very important. This document describes the various types of personal information provided to and collected by kapima.se, and how this information is used.",
    cookiesQuestion: "Does the dashboard use cookies?",
    cookiesP1:
      "Yes, the dashboard uses standard cookies. Cookies are text files stored in the visitor's browser (for example when visiting a website via a computer or mobile phone). Cookies are mainly used to improve website functionality. Cookies are stored alongside the files used by the computer's browser or equivalent program.",
    cookiesP2:
      "If you want to prevent your computer from storing these cookies, you can do so by adjusting the settings in your browser. Go to settings and security in your browser and choose not to allow cookies. However, it is recommended that you keep cookies enabled in your browser, as this improves your experience of the dashboard.",
  },
};

export default function Profile({ user, setUser, setActiveTab }) {
  const [lang, setLang] = useState("sv");
  const t = T[lang];

  const [password, setPassword] = useState("");
  const [name, setName] = useState(user.name || "");
  const [email, setEmail] = useState(user.email || "");
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  // 🔥 Mina aktiviteter
  const [myTasks, setMyTasks] = useState([]);
  // Visa även klara aktiviteter från början; användaren kan välja att dölja dem.
  const [showDone, setShowDone] = useState(true);
  /* ---------------- HÄMTA MINA AKTIVITETER ---------------- */
  useEffect(() => {
    const loadTasks = async () => {
      try {
        const token = localStorage.getItem("token") || "";
        const res = await apiFetch(`/activities`, {
          headers: {
            Authorization: `Bearer ${token}`,
          },
        });

        if (!res.ok) {
          throw new Error(`HTTP ${res.status}`);
        }

        const tasks = await res.json();
        // createdBy anger vem som skickade in aktiviteten. responsible är
        // den som tilldelats ansvaret och används därför inte här.
        const userTasks = Array.isArray(tasks)
          ? tasks.filter((task) => task.createdBy === user.name)
          : [];

        setMyTasks(userTasks);
      } catch (err) {
        console.error("Kunde inte hämta aktiviteter:", err);
        setMyTasks([]);
      }
    };

    if (user.name) loadTasks();
    else setMyTasks([]);
  }, [user.name]);

  useEffect(() => {
    setName(user.name || "");
    setEmail(user.email || "");
  }, [user]);

  const visibleTasks = myTasks
    .filter((task) => (showDone ? true : !task.done))
    .sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));

  const formatCreatedAt = (createdAt) => {
    if (!createdAt) return "";
    const date = new Date(createdAt);
    return Number.isNaN(date.getTime())
      ? ""
      : date.toLocaleDateString(lang === "sv" ? "sv-SE" : "en-GB");
  };
  const hasValidEmail =
    user.email && user.email !== "-" && user.email.includes("@");

  /* ---------------- BYTA LÖSENORD / PROFIL ---------------- */
  const updateProfile = async () => {
    setMsg("");
    setLoading(true);

    try {
      const body = { name, email };
      if (password) body.password = password; // uppdatera lösenord endast om angivet

      const res = await apiFetch(`/users/${user._id}`, {
        method: "PUT",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${localStorage.getItem("token") || ""}`,
        },
        body: JSON.stringify(body),
      });

      const data = await res.json();

      if (data.success) {
        setMsg(t.profileUpdated);
        setPassword("");

        // ✅ VIKTIGT: uppdatera user i frontend
        setUser((prev) => ({
          ...prev,
          name,
          email,
        }));
      } else {
        setMsg(t.profileError(data.error));
      }
    } catch {
      setMsg(t.connectionError);
    }

    setLoading(false);
  };

  return (
    <div className="profile-box">
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          marginBottom: "8px",
        }}
      >
        <h2>{t.title}</h2>
        <button
          type="button"
          className="btn-secondary"
          onClick={() => setLang((prev) => (prev === "sv" ? "en" : "sv"))}
        >
          {lang === "sv" ? "🇬🇧 English" : "🇸🇪 Svenska"}
        </button>
      </div>

      {/* PROFILINFO */}
      <div className="profile-info">
        <p>
          <strong>{t.username}</strong> {user.username}
        </p>

        <p>
          <strong>{t.role}</strong>
          <span className={`role-badge ${user.role}`}>
            {user.role === "admin"
              ? t.roleLabels.admin
              : user.role === "view"
              ? t.roleLabels.view
              : user.role === "suAdmin"
              ? t.roleLabels.suAdmin
              : t.roleLabels.user}
          </span>
        </p>

        <strong>{t.name}</strong>
        <input
          type="text"
          className="profile-input"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <strong>{t.email}</strong>
        <input
          type="email"
          className="profile-input"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <strong>{t.password}</strong>
        <input
          type="password"
          className="profile-input"
          placeholder={t.passwordPlaceholder}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <button className="btn-primary" onClick={updateProfile} disabled={loading}>
          {loading ? t.updating : t.updateButton}
        </button>
      </div>

      {/* MINA AKTIVITETER */}
      <div className="profile-section">
        <div className="my-task-list">
          <h3>{t.myActivities}</h3>

          <button
            className="btn-primary"
            onClick={() => setShowDone((prev) => !prev)}
            style={{ marginBottom: "10px" }}
          >
            {showDone ? t.hideDone : t.showDone}
          </button>

          {visibleTasks.length > 0 ? (
            <ul className="task-ul-no-bullets">
              {visibleTasks.map((task) => (
                <li key={task._id} className="my-task-item">
                  <strong>{task.title}</strong>
                  <div className="my-task-meta">
                    <span>{task.category}</span>
                    {formatCreatedAt(task.createdAt) && (
                      <span>{formatCreatedAt(task.createdAt)}</span>
                    )}
                    {task.done && (
                      <span className="task-done-tag">{t.doneTag}</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          ) : (
            <p className="empty">{t.noActivities}</p>
          )}

          {setActiveTab && (
            <p style={{ marginBottom: "5px" }}>
              <button
                className="btn-secondary"
                onClick={() => setActiveTab("activities")}
              >
                {t.goToActivities}
              </button>
            </p>
          )}
        </div>
      </div>

      {msg && (
        <div className={`profile-message ${msg.includes("✔️") ? "success" : "error"}`}>
          {msg}
        </div>
      )}

      <div className="profile-section">
        <h3>{t.privacyTitle}</h3>
        <p>
          <i>{t.privacyP1}</i>
        </p>
        <p>
          <i>{t.privacyP2}</i>
        </p>
        <p>
          <i>{t.privacyP3}</i>
        </p>
        <p>
          <strong>{t.cookiesQuestion}</strong>
        </p>
        <p>
          <i>{t.cookiesP1}</i>
        </p>
        <p>
          <i>{t.cookiesP2}</i>
        </p>
      </div>
    </div>
  );
}