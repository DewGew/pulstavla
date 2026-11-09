import { useEffect, useState } from "react";
import { apiFetch } from "../api";
import { API_URL, VERSION } from "../config";
import AdminUsers from "./AdminUsers";
import "./Settings.css";

const year = new Date().getFullYear();
const YEAR_LABEL = (year - 2) + "/" + (year - 1)

export default function Settings() {
	const [settings, setSettings] = useState(null);

	const [company, setCompany] = useState("");
	const [address, setAddress] = useState("");
	const [email, setEmail] = useState("");
	
	const [apiUrl, setApiUrl] = useState("");
	const [wsUrl, setWsUrl] = useState("");
	const [interval, setIntervalValue] = useState(10000);
	const [lat, setLat] = useState(56.1612);
	const [lon, setLon] = useState(15.5869);
	const [qual, setQual] = useState(0);
	const [qual2, setQual2] = useState(0);
	const [yearLabel, setYearLabel] = useState("");

	const [machines, setMachines] = useState([]);
	const [machineGroups, setMachineGroups] = useState({});

	const [newGroupKey, setNewGroupKey] = useState("");
	const [newGroupLabel, setNewGroupLabel] = useState("");

	const [newMachineName, setNewMachineName] = useState("");
	const [newMachineGroup, setNewMachineGroup] = useState("");
	const [checklists, setChecklists] = useState({});

	const [saving, setSaving] = useState(false);
	const [message, setMessage] = useState("");
	const [activeTab, setActiveTab] = useState("general");
	const [selectedGroup, setSelectedGroup] = useState("");

	const token = localStorage.getItem("token");
	const currentUser = JSON.parse(localStorage.getItem("user"));
	const canEdit = currentUser?.role === "suAdmin";
	const [imageExists, setImageExists] = useState(true);
	
	const FRAS_DEFAULT_CHECKLIST = {
			weekly: {
				title: "Veckokontroll / Weekly check",
				tasks: [
					"Kolla oljenivån / Check oil levels",
					"Kolla kylvattennivå / Check cooling water levels",
					"Rensa alla spånor / Clear all chips",
					"Spola maskinen rent / Rinse the machine clean",
					"Kolla filter för TSC / Check filter",
					"Rensa rutorna / Clean windows",
					"Städa maskinen utanpå / Clean outside",
					"Moppa golvet runt maskinen / Mop floor",
					"Lämna tillbaka verktyg / Return tools",
					"Rengöring av spindelkona / Cleaning the spindle cone",
				],
			},
			monthly: {
				title: "Månadskontroll / Monthly check",
				tasks: [
					"Städa uppe på maskinen / Clean on top",
					"Kör oljeseparator / Run oil separator",
					"Kontrollera nödstopp / Check emergency stop",
				],
			},
			halfyear: {
				title: "Halvårs kontroll / Halfyear check",
				tasks: [
					"Töm spånlådan på kyltanken / Clean chip basket",
					"Avlägsna spånor från kyltanken / Remove chips",
					"Inventera och släng onödigt / Take inventory and throw away unnecessary things",
					"Kalibrering av spindel kast och nollpunkter / Calibration of spindle runout and zero points",
				],
			},
			yearly: {
				title: "Årlig kontroll / Yearly check",
				tasks: [
					"Kolla oljefilter / Check oil filter",
					"Kontrollera luftfilter / Check air filter",
				],
			},
		};


  useEffect(() => {
    apiFetch(`/settings`, {
      headers: { Authorization: `Bearer ${token}` },
    })
      .then(res => res.json())
      .then(data => {
        setSettings(data);
        setCompany(data.company || "");
		setAddress(data.address || "");
		setEmail(data.email || "");
        setApiUrl(data.system?.apiUrl || "");
        setWsUrl(data.system?.wsUrl || "");
		setIntervalValue(data.system?.interval || 10000);
		setLat(data.system?.lat || 56.1612);
		setLon(data.system?.lon || 15.5869);
		setQual(data.system?.qual || 0);
		setQual2(data.system?.qual2 || 0);
		setYearLabel(data.system?.yearLabel || "");
        setMachines(data.machines?.list || []);
        setMachineGroups(data.machines?.groups || {});
		setChecklists(data.checklists || {});
		setSelectedGroup(Object.keys(data.machines?.groups || {})[0] || "");
      });
  }, []);
	
	useEffect(() => {
		if (!settings || !machineGroups) return;

		setChecklists(prev => {
			const copy = structuredClone(prev || {});
			Object.keys(machineGroups).forEach(groupKey => {
				if (!copy[groupKey]) {
					copy[groupKey] = structuredClone(FRAS_DEFAULT_CHECKLIST);
				}
			});
			return copy;
		});
	}, [settings, machineGroups]);

  async function saveCompany() {
	  setSaving(true);
	  setMessage("");

	  await Promise.all([
		apiFetch(`/settings/company`, {
		  method: "PUT",
		  headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		  },
		  body: JSON.stringify({ value: company }),
		}),
		apiFetch(`/settings/address`, {
		  method: "PUT",
		  headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		  },
		  body: JSON.stringify({ value: address }),
		}),
		apiFetch(`/settings/email`, {
		  method: "PUT",
		  headers: {
			"Content-Type": "application/json",
			Authorization: `Bearer ${token}`,
		  },
		  body: JSON.stringify({ value: email }),
		}),
	  ]);

	  setSaving(false);
	  setMessage("Företagsuppgifter sparade");
	}

  async function saveSystem() {
    setSaving(true);
    setMessage("");

    await apiFetch(`/settings/system`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        value: { apiUrl, wsUrl, interval, lat, lon, qual, qual2, yearLabel },
      }),
    });

    setSaving(false);
    setMessage("Systeminställningar sparade");
  }

  async function saveMachines() {
    setSaving(true);
    setMessage("");

    await apiFetch(`/settings/machines`, {
      method: "PUT",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({
        value: {
          groups: machineGroups,
          list: machines,
        },
      }),
    });

    setSaving(false);
    setMessage("Resurser och grupper sparade");
  }

  if (!settings) return <p>Laddar inställningar...</p>;

  return (
    <div className="settings-box">
      <h2>Inställningar</h2>
			<div className="settings-tabs">
			
				<button
					className={activeTab === "general" ? "active" : ""}
					onClick={() => setActiveTab("general")}
				>
					Allmänt
				</button>

				<button
					className={activeTab === "system" ? "active" : ""}
					onClick={() => setActiveTab("system")}
				>
					System
				</button>

				<button
					className={activeTab === "machines" ? "active" : ""}
					onClick={() => setActiveTab("machines")}
				>
					Resurser
				</button>
				<button
					className={activeTab === "checklistor" ? "active" : ""}
					onClick={() => setActiveTab("checklistor")}
				>
					Checklistor
				</button>
				
				<button
					className={activeTab === "users" ? "active" : ""}
					onClick={() => setActiveTab("users")}
				>
					Användare
				</button>
				
			</div>

      {/* ALLMÄNT */}
      {activeTab === "general" && (
				<section className="settings-section">
					<div style={{borderTop: '1px dashed var(--panel-border, #e5e7eb)', marginBottom: 10}}></div>
					<h3>Allmänt</h3>
					<div style={{borderTop: '1px dashed var(--panel-border, #e5e7eb)', marginBottom: 10}}></div>
					
					<label>
						Företagsnamn
						<input
							className="settings-input"
							value={company}
							onChange={e => setCompany(e.target.value)}
						/>
						<small style={{ display: "block", opacity: 0.7, marginBottom: 4 }}>
							Visas i sidhuvudet, visas t.ex. på utskrifter. {!imageExists && ("För att visa logo Pulstavlan och på pdf:er. Ladda upp logon med namnet 'logo.png' i dokument")}
						</small>
					</label>
					{imageExists && (
						<img 
							src="./docs/logo.png" 
							alt="Logotyp" 
							onError={() => setImageExists(false)}
							width={200}
						/>
					)}
					<label>
					  Adress
					  <input
						className="settings-input"
						value={address}
						onChange={e => setAddress(e.target.value)}
					  />
					  <small style={{ display: "block", opacity: 0.7, marginBottom: 4 }}>
						Företagets adress, visas t.ex. på utskrifter.
					  </small>
					</label>
					<label>
					  Kontakt
					  <input
						className="settings-input"
						value={email}
						onChange={e => setEmail(e.target.value)}
					  />
					  <small style={{ display: "block", opacity: 0.7, marginBottom: 4 }}>
						Företagets email, visas t.ex. på utskrifter.
					  </small>
					</label>

					<button className="btn-primary" onClick={saveCompany} disabled={saving}>
						Spara
					</button>
					
					<div style={{borderTop: '1px dashed var(--panel-border, #e5e7eb)', marginBottom: 10}}></div>
					<h3>Om</h3>
					<div style={{borderTop: '1px dashed var(--panel-border, #e5e7eb)', marginBottom: 10}}></div>
					
					<p><i>Pulstavla har version {VERSION} och är byggd på REACT/VITE webbserver ramverk till {company} av Kapima. Epost: <a href="mailto:info@kapima.se">info@kapima.se</a></i></p>
				</section>
			)}

      {/* SYSTEM */}
      {activeTab === "system" && (
				<section className="settings-section">
					<div style={{borderTop: '1px dashed var(--panel-border, #e5e7eb)', marginBottom: 10}}></div>
					<h3>System</h3>
					<div style={{borderTop: '1px dashed var(--panel-border, #e5e7eb)', marginBottom: 10}}></div>

					{canEdit && (
					/* Denna Inställning fungerar inte annu */
						<label>
							API URL
							<input
								className="settings-input"
								value={apiUrl}
								onChange={e => setApiUrl(e.target.value)}
							/>
							<small style={{ display: "block", opacity: 0.7, marginBottom: 4 }}>
								Adress till pulstavlan 
							</small>
						</label>
					)}
					{canEdit && (
					/* Denna Inställning fungerar inte annu */
						<label>
							WebSocket URL
							<input
								className="settings-input"
								placeholder="t.ex wss://192.168.1.100:123"
								value={wsUrl}
								onChange={e => setWsUrl(e.target.value)}
							/>
							<small style={{ display: "block", opacity: 0.7, marginBottom: 4 }}>
								Adress för live uppdateringar.
							</small>
						</label>
					)}
					
					<label>
						Widget-rotationsintervall (ms)
						<input
							type="number"
							className="settings-input"
							value={interval}
							onChange={e => setIntervalValue(Number(e.target.value))}
						/>
						<small style={{ display: "block", opacity: 0.7, marginBottom: 4 }}>
							Tid för rotations-widget att byta sida.
						</small>
					</label>
					
					<div style={{borderTop: '1px dashed var(--panel-border, #e5e7eb)', marginBottom: 10}}></div>
					<h3>Widget Inställningar</h3>
					<div style={{borderTop: '1px dashed var(--panel-border, #e5e7eb)', marginBottom: 10}}></div>
					
					<label>
						Plats latitiud/longitude
						<input
							type="number"
							className="settings-input"
							value={lat}
							onChange={e => setLat(Number(e.target.value))}
						/>
						<input
							type="number"
							className="settings-input"
							value={lon}
							onChange={e => setLon(Number(e.target.value))}
						/>
						<small style={{ display: "block", opacity: 0.7, marginBottom: 4 }}>
							Ange plats för korrekt väderprognos.
						</small>
					</label>
									
					<label>
						Kvalitetsbrist kostnader föregående år
						<input
							type="number"
							className="settings-input"
							value={qual}
							onChange={e => setQual(Number(e.target.value))}
						/>
						<small style={{ display: "block", opacity: 0.7, marginBottom: 4 }}>
							Visas i Kvalitetsbrist widget.
						</small>
					</label>
					<label>
						Kvalitetsbrist kostnader för
						<input
							type="text"
							className="settings-input"
							placeholder="t.ex 2024/2025"
							value={yearLabel}
							onChange={e => setYearLabel(e.target.value)}
						/>
						<input
							type="number"
							className="settings-input"
							value={qual2}
							onChange={e => setQual2(Number(e.target.value))}
						/>
						<small style={{ display: "block", opacity: 0.7, marginBottom: 4 }}>
							Visas i Kvalitetsbrist widget. Sätt till 0 för att inte visas i widget.
						</small>
					</label>

					<button className="btn-primary" onClick={saveSystem} disabled={saving}>
						Spara systeminställningar
					</button>
				</section>
			)}
			
      {/* MASKINGRUPPER */}
			{activeTab === "machines" && (
			<>
					<section className="settings-section">
						<h3>Resursgrupper</h3>

						{Object.entries(machineGroups).map(([key, label]) => {
							const used = machines.some(m => m.group === key);

							return (
								<div key={key} style={{ display: "flex", gap: 8 }}>
									<input
										className="settings-input"
										value={label}
										onChange={e =>
											setMachineGroups(prev => ({
												...prev,
												[key]: e.target.value,
											}))
										}
									/>

									<button
										className="btn-danger"
										disabled={used}
										title={used ? "Gruppen används av resurser" : "Ta bort grupp"}
										onClick={() => {
											if (!window.confirm(`Ta bort grupp "${label}"?`)) return;

											const copy = { ...machineGroups };
											delete copy[key];
											setMachineGroups(copy);
										}}
									>
										✖
									</button>
								</div>
							);
						})}

						{/* Lägg till ny grupp */}
						<div style={{ display: "flex", gap: 8, marginTop: 10 }}>
							<input
								className="settings-input"
								placeholder="Nyckel (ex FRAS)"
								value={newGroupKey}
								onChange={e => setNewGroupKey(e.target.value.toUpperCase())}
							/>
							<input
								className="settings-input"
								placeholder="Visningsnamn"
								value={newGroupLabel}
								onChange={e => setNewGroupLabel(e.target.value)}
							/>

							<button
								className="btn-primary"
								onClick={() => {
									if (!newGroupKey || !newGroupLabel) return;

									setMachineGroups(prev => ({
										...prev,
										[newGroupKey]: newGroupLabel,
									}));

									setNewGroupKey("");
									setNewGroupLabel("");
								}}
							>
								➕
							</button>
							</div>
					</section>


					{/* MASKINER */}
					<section className="settings-section">
						<h3>Resurser</h3>

						{machines.map((m, i) => (
							<div
								key={i}
								style={{
									display: "grid",
									gridTemplateColumns: "1fr 2fr 1fr auto auto",
									gap: 8,
									alignItems: "center",
									marginBottom: 6,
								}}
							>
								{/* 🔢 Maskinnummer */}
								<input
									className="settings-input"
									placeholder="Resursnr"
									value={m.number || ""}
									onChange={e => {
										const copy = [...machines];
										copy[i] = { ...copy[i], number: e.target.value };
										setMachines(copy);
									}}
								/>

								{/* Namn */}
								<input
									className="settings-input"
									value={m.name}
									onChange={e => {
										const copy = [...machines];
										copy[i] = { ...copy[i], name: e.target.value };
										setMachines(copy);
									}}
								/>

								{/* Grupp */}
								<select
									className="settings-input"
									value={m.group}
									onChange={e => {
										const copy = [...machines];
										copy[i] = { ...copy[i], group: e.target.value };
										setMachines(copy);
									}}
								>
									{Object.keys(machineGroups).map(g => (
										<option key={g} value={g}>
											{machineGroups[g]}
										</option>
									))}
								</select>

								{/* Visible */}
								<label
									style={{
										display: "flex",
										alignItems: "center",
										gap: 4,
										whiteSpace: "nowrap",
										fontSize: "0.9rem",
									}}
								>
									<input
										type="checkbox"
										checked={m.visible !== false}
										onChange={e => {
											const copy = [...machines];
											copy[i] = { ...copy[i], visible: e.target.checked };
											setMachines(copy);
										}}
									/>
									Visa
								</label>

								<button
									className="btn-danger"
									onClick={() => {
										if (!window.confirm(`Ta bort "${m.name}"?`)) return;
										setMachines(prev => prev.filter((_, idx) => idx !== i));
									}}
								>
									✖
								</button>
							</div>
						))}

						{/* Lägg till ny maskin */}
						<div style={{ display: "flex", gap: 8, marginTop: 10 }}>
							<input
								className="settings-input"
								placeholder="Resursnamn"
								value={newMachineName}
								onChange={e => setNewMachineName(e.target.value)}
							/>

							<select
								className="settings-input"
								value={newMachineGroup}
								onChange={e => setNewMachineGroup(e.target.value)}
							>
								{Object.keys(machineGroups).map(g => (
									<option key={g} value={g}>
										{machineGroups[g]}
									</option>
								))}
							</select>

							<button
								className="btn-primary"
								onClick={() => {
									if (!newMachineName || !newMachineGroup) return;

									setMachines(prev => [
										...prev,
										{
											number: "",
											name: newMachineName,
											group: newMachineGroup,
											visible: true,
										},
									]);

									setNewMachineName("");
									setNewMachineGroup(Object.keys(machineGroups)[0] || "");
								}}
							>
								➕
							</button>
						</div>

						<button
							className="btn-primary"
							style={{ marginTop: 12 }}
							onClick={saveMachines}
						>
							Spara resurs
						</button>
					</section>
				</>
			)}
			{activeTab === "checklistor" && selectedGroup && (
				<section className="settings-section">
					<h3>Checklistor per grupp</h3>

					<select
						className="settings-input"
						value={selectedGroup}
						onChange={e => setSelectedGroup(e.target.value)}
					>
						{Object.entries(machineGroups).map(([key, label]) => (
							<option key={key} value={key}>
								{label}
							</option>
						))}
					</select>

					{Object.entries(checklists[selectedGroup] || {}).map(
						([sectionKey, section]) => (
							<div key={sectionKey} style={{ marginBottom: 20 }}>
								<strong>{section.title}</strong>

								{section.tasks.map((task, i) => (
									<div
										key={i}
										style={{ display: "flex", gap: 6, alignItems: "center" }}
									>
										<input
											className="settings-input"
											value={task}
											onChange={e => {
												const copy = structuredClone(checklists);
												copy[selectedGroup][sectionKey].tasks[i] = e.target.value;
												setChecklists(copy);
											}}
										/>

										{/* 🗑 TA BORT RAD */}
										<button
											className="btn-danger"
											title="Ta bort rad"
											onClick={() => {
												const copy = structuredClone(checklists);
												copy[selectedGroup][sectionKey].tasks.splice(i, 1);
												setChecklists(copy);
											}}
										>
											✖
										</button>
									</div>
								))}

								<button
									className="btn-primary"
									style={{ marginTop: 6 }}
									onClick={() => {
										const copy = structuredClone(checklists);
										copy[selectedGroup][sectionKey].tasks.push("");
										setChecklists(copy);
									}}
								>
									➕ Lägg till rad
								</button>
							</div>
						)
					)}

					<button
						className="btn-primary"
						onClick={async () => {
							setSaving(true);
							setMessage("");

							await apiFetch(`/settings/checklists`, {
								method: "PUT",
								headers: {
									"Content-Type": "application/json",
									Authorization: `Bearer ${token}`,
								},
								body: JSON.stringify({ value: checklists }),
							});

							setSaving(false);
							setMessage("Checklistor sparade");
						}}
					>
						Spara checklistor
					</button>
				</section>
			)}
			{activeTab === "users" && (
				<section className="settings-section">
					<h3>Hantera användare</h3>
					<AdminUsers currentUser={currentUser} hideTitle flat />
				</section>
			)}
      {message && <div className="profile-message success">{message}</div>}
    </div>
  );
}
