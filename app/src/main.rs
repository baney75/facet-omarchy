use adw::prelude::*;
use gtk::{gdk, gio, glib};
use serde::{Deserialize, Serialize};
use std::cell::{Cell, RefCell};
use std::path::PathBuf;
use std::rc::Rc;
use std::time::Instant;
use webkit6::prelude::*;
use {libadwaita as adw, gtk4 as gtk};

const APP_ID: &str = "app.panes.browser";
const SPACE_TINTS: usize = 6;
const MAX_COMMAND_RESULTS: usize = 8;
const COMMANDS: &[(&str, &str, &str)] = &[
    ("New Space", "new-space", "list-add-symbolic"),
    ("Add or Remove Favorite", "favorite", "starred-symbolic"),
    ("Find in Page", "find", "edit-find-symbolic"),
    ("Toggle Sidebar", "toggle-sidebar", "sidebar-show-symbolic"),
    ("Reload Page", "reload", "view-refresh-symbolic"),
    ("Close Tab", "close-tab", "window-close-symbolic"),
    ("Reader Mode", "page-reader", "view-paged-symbolic"),
    ("Dark Mode for This Site", "page-toggleDark", "weather-clear-night-symbolic"),
    ("Calm Mode for This Site", "page-toggleCalm", "face-calm-symbolic"),
    ("Highlight Selection", "page-highlight", "edit-select-all-symbolic"),
    ("Remove Highlight", "page-removeHighlight", "edit-clear-symbolic"),
    ("Copy Page as Markdown", "page-copyPageMarkdown", "edit-copy-symbolic"),
    ("Copy Clean Link", "page-copyCleanLink", "insert-link-symbolic"),
    ("Copy Markdown Link", "page-copyMarkdownLink", "insert-link-symbolic"),
    ("Picture in Picture", "page-videoPip", "video-display-symbolic"),
];
const CONTEXT_ACTIONS: &[(&str, &str)] = &[
    ("Reader Mode", "reader"),
    ("Highlight Selection", "highlight"),
    ("Remove Highlight", "removeHighlight"),
    ("Copy Clean Link", "copyCleanLink"),
    ("Copy Markdown Link", "copyMarkdownLink"),
    ("Copy Page as Markdown", "copyPageMarkdown"),
    ("Dark Mode for This Site", "toggleDark"),
    ("Calm Mode for This Site", "toggleCalm"),
];
const PAGE_WORLD: &str = "facet";
const PAGE_START: &[&str] = &[include_str!("page-shim.js"), include_str!("../../extension/page/core.js"), include_str!("../../extension/page/dark.js")];
const PAGE_IDLE: &[&str] = &[
    include_str!("../../extension/page/extract.js"),
    include_str!("../../extension/page/links.js"),
    include_str!("../../extension/page/reader.js"),
    include_str!("../../extension/page/highlights.js"),
    include_str!("../../extension/page/calm.js"),
    include_str!("../../extension/page/video.js"),
    include_str!("../../extension/page/sponsor.js"),
    include_str!("../../extension/page/peek.js"),
];

#[derive(Clone, Copy)]
enum Target {
    Typed,
    Tab(usize, usize),
    Action(&'static str),
}

#[derive(Serialize, Deserialize, Default)]
struct SavedSpace {
    name: String,
    urls: Vec<String>,
}

#[derive(Serialize, Deserialize, Default)]
struct Session {
    active: usize,
    spaces: Vec<SavedSpace>,
    #[serde(default)]
    favorites: Vec<String>,
}

struct Tab {
    view: webkit6::WebView,
    row: gtk::ListBoxRow,
    // Restored tabs hold their URL here and load only when first shown.
    pending: RefCell<Option<String>>,
}

impl Tab {
    fn url(&self) -> Option<String> {
        self.pending.borrow().clone().or_else(|| self.view.uri().map(|u| u.to_string()))
    }

    fn title(&self) -> String {
        self.view.title().map(|t| t.to_string()).filter(|t| !t.is_empty()).or_else(|| self.url().filter(|u| !is_internal(u))).unwrap_or_else(|| "New Tab".into())
    }
}

struct Space {
    name: String,
    list: gtk::ListBox,
    tabs: Vec<Tab>,
}

struct Command {
    root: gtk::Box,
    entry: gtk::Entry,
    results: gtk::ListBox,
    opens_new_tab: Cell<bool>,
    targets: RefCell<Vec<Target>>,
}

struct Find {
    root: gtk::Box,
    entry: gtk::SearchEntry,
}

struct Browser {
    window: adw::ApplicationWindow,
    root: gtk::Box,
    pages: gtk::Stack,
    lists: gtk::Stack,
    switcher: gtk::Box,
    favorites_box: gtk::FlowBox,
    address: gtk::Entry,
    progress: gtk::ProgressBar,
    sidebar: gtk::Revealer,
    hover_revealed: Cell<bool>,
    favicons: Option<webkit6::FaviconDatabase>,
    editing_address: Cell<bool>,
    toasts: adw::ToastOverlay,
    command: Command,
    find: Find,
    network: webkit6::NetworkSession,
    content: webkit6::UserContentManager,
    page_store: RefCell<serde_json::Map<String, serde_json::Value>>,
    spaces: RefCell<Vec<Space>>,
    favorites: RefCell<Vec<String>>,
    active: Cell<usize>,
    next_id: Cell<u64>,
    started: Instant,
    smoke: Cell<bool>,
}

fn data_dir() -> PathBuf {
    glib::user_data_dir().join("facet")
}

fn session_path() -> PathBuf {
    data_dir().join("session.json")
}

fn page_store_path() -> PathBuf {
    data_dir().join("page-store.json")
}

fn host_of(url: &str) -> Option<String> {
    let host = glib::Uri::parse(url, glib::UriFlags::NONE).ok()?.host()?.to_string();
    Some(host.strip_prefix("www.").unwrap_or(&host).to_string())
}

fn is_internal(url: &str) -> bool {
    url.starts_with("facet:") || url == "about:blank"
}

/// Turns address bar input into a URL, treating anything that isn't address-shaped as a search.
fn resolve_input(input: &str) -> String {
    let text = input.trim();
    let has_scheme = text.contains("://") || text.starts_with("about:");
    let looks_like_host = !text.contains(' ') && (text.contains('.') || text.starts_with("localhost"));
    if has_scheme {
        text.to_string()
    } else if looks_like_host {
        format!("https://{text}")
    } else {
        format!("https://duckduckgo.com/?q={}", glib::Uri::escape_string(text, None, false))
    }
}

fn icon_button(icon: &str, tooltip: &str) -> gtk::Button {
    let button = gtk::Button::from_icon_name(icon);
    button.add_css_class("flat");
    button.add_css_class("facet-icon-button");
    button.set_tooltip_text(Some(tooltip));
    button
}

fn unique_download_path(suggested: &str) -> PathBuf {
    let dir = glib::user_special_dir(glib::UserDirectory::Downloads).unwrap_or_else(glib::home_dir);
    let name = std::path::Path::new(suggested).file_name().map(|n| n.to_string_lossy().to_string()).unwrap_or_else(|| "download".into());
    let first = dir.join(&name);
    if !first.exists() {
        return first;
    }
    let path = std::path::Path::new(&name);
    let stem = path.file_stem().map(|s| s.to_string_lossy().to_string()).unwrap_or_default();
    let ext = path.extension().map(|e| format!(".{}", e.to_string_lossy())).unwrap_or_default();
    (1..).map(|n| dir.join(format!("{stem} ({n}){ext}"))).find(|p| !p.exists()).expect("unbounded range")
}

impl Browser {
    fn load_if_pending(&self, row: &gtk::ListBoxRow) {
        let spaces = self.spaces.borrow();
        let Some(tab) = spaces.iter().flat_map(|s| s.tabs.iter()).find(|t| &t.row == row) else { return };
        let url = tab.pending.borrow_mut().take();
        if let Some(url) = url {
            tab.view.load_uri(&url);
        }
    }

    fn selected_tab_index(&self) -> Option<usize> {
        let spaces = self.spaces.borrow();
        let space = spaces.get(self.active.get())?;
        let row = space.list.selected_row()?;
        space.tabs.iter().position(|t| t.row == row)
    }

    fn current_view(&self) -> Option<webkit6::WebView> {
        let index = self.selected_tab_index()?;
        Some(self.spaces.borrow()[self.active.get()].tabs[index].view.clone())
    }

    fn current_url(&self) -> String {
        self.current_view().and_then(|v| v.uri()).map(|u| u.to_string()).unwrap_or_default()
    }

    fn sync_address(&self) {
        if self.editing_address.get() {
            return;
        }
        let url = self.current_url();
        let secure = url.starts_with("https://");
        self.address.set_icon_from_icon_name(gtk::EntryIconPosition::Primary, secure.then_some("changes-prevent-symbolic"));
        gtk::prelude::EntryExt::set_alignment(&self.address, 0.5);
        self.address.set_text(&if is_internal(&url) { String::new() } else { host_of(&url).unwrap_or(url) });
    }

    fn home_url(&self) -> String {
        format!("facet://start/?tint={}", self.active.get() % SPACE_TINTS)
    }

    fn start_page(&self) -> String {
        let favorites = serde_json::to_string(&*self.favorites.borrow()).unwrap_or_else(|_| "[]".into()).replace('<', "\\u003c");
        include_str!("start.html").replace("/*DATA*/", &format!("const FAVORITES={favorites};"))
    }

    fn sync_progress(&self) {
        let view = self.current_view();
        let progress = view.as_ref().filter(|v| v.is_loading()).map(|v| v.estimated_load_progress());
        self.progress.set_visible(progress.is_some());
        self.progress.set_fraction(progress.unwrap_or(0.0));
    }

    fn set_sidebar(&self, shown: bool) {
        self.sidebar.set_reveal_child(shown);
        if shown { self.root.remove_css_class("collapsed") } else { self.root.add_css_class("collapsed") }
    }

    fn save(&self) {
        let spaces = self.spaces.borrow();
        let session = Session {
            active: self.active.get(),
            favorites: self.favorites.borrow().clone(),
            spaces: spaces.iter().map(|s| SavedSpace { name: s.name.clone(), urls: s.tabs.iter().filter_map(Tab::url).collect() }).collect(),
        };
        let _ = std::fs::create_dir_all(data_dir());
        if let Ok(json) = serde_json::to_string_pretty(&session) {
            let _ = std::fs::write(session_path(), json);
        }
    }

    fn toast(&self, text: &str) {
        self.toasts.add_toast(adw::Toast::new(text));
    }

    fn add_space(self: &Rc<Self>, name: &str) -> usize {
        let list = gtk::ListBox::new();
        list.set_selection_mode(gtk::SelectionMode::Browse);
        let this = Rc::downgrade(self);
        list.connect_row_selected(move |_, row| {
            let (Some(this), Some(row)) = (this.upgrade(), row) else { return };
            this.load_if_pending(row);
            this.pages.set_visible_child_name(row.widget_name().as_str());
            this.sync_address();
            this.sync_progress();
        });
        let index = self.spaces.borrow().len();
        self.lists.add_named(&list, Some(&format!("space-{index}")));
        self.spaces.borrow_mut().push(Space { name: name.to_string(), list, tabs: Vec::new() });
        index
    }

    fn render_switcher(self: &Rc<Self>) {
        while let Some(child) = self.switcher.first_child() {
            self.switcher.remove(&child);
        }
        let names: Vec<String> = self.spaces.borrow().iter().map(|s| s.name.clone()).collect();
        let active = self.active.get();
        for (index, name) in names.iter().enumerate() {
            let button = gtk::Button::new();
            button.add_css_class("flat");
            button.add_css_class("facet-space");
            button.set_tooltip_text(Some(name));
            if index == active {
                button.set_label(name);
                button.add_css_class("active");
                button.add_css_class(&format!("tint-{}", index % SPACE_TINTS));
            } else {
                let dot = gtk::Box::new(gtk::Orientation::Horizontal, 0);
                dot.set_valign(gtk::Align::Center);
                dot.set_halign(gtk::Align::Center);
                dot.add_css_class("facet-dot");
                dot.add_css_class(&format!("dot-{}", index % SPACE_TINTS));
                button.set_child(Some(&dot));
            }
            let this = Rc::downgrade(self);
            button.connect_clicked(move |_| {
                if let Some(this) = this.upgrade() {
                    this.switch_space(index);
                }
            });
            self.switcher.append(&button);
        }
    }

    fn switch_space(self: &Rc<Self>, index: usize) {
        if index >= self.spaces.borrow().len() {
            return;
        }
        self.active.set(index);
        for tint in 0..SPACE_TINTS {
            self.root.remove_css_class(&format!("space-tint-{tint}"));
        }
        self.root.add_css_class(&format!("space-tint-{}", index % SPACE_TINTS));
        self.lists.set_visible_child_name(&format!("space-{index}"));
        if self.spaces.borrow()[index].tabs.is_empty() {
            self.open_tab(&self.home_url());
        }
        let (list, row) = {
            let spaces = self.spaces.borrow();
            let space = &spaces[index];
            (space.list.clone(), space.list.selected_row().or_else(|| space.tabs.first().map(|t| t.row.clone())))
        };
        if let Some(row) = row {
            if list.selected_row().as_ref() == Some(&row) {
                self.pages.set_visible_child_name(row.widget_name().as_str());
            } else {
                list.select_row(Some(&row));
            }
        }
        self.sync_address();
        self.render_switcher();
        self.save();
    }

    fn new_space(self: &Rc<Self>) {
        let number = self.spaces.borrow().len() + 1;
        let index = self.add_space(&format!("Space {number}"));
        self.switch_space(index);
    }

    fn open_tab(self: &Rc<Self>, url: &str) {
        let view = webkit6::WebView::builder().network_session(&self.network).user_content_manager(&self.content).build();
        self.attach_view(view.clone(), None, true);
        view.load_uri(url);
    }

    fn add_restored_tab(self: &Rc<Self>, url: &str) {
        let view = webkit6::WebView::builder().network_session(&self.network).user_content_manager(&self.content).build();
        self.attach_view(view, Some(url.to_string()), false);
    }

    /// Adds a view to the current Space; pop-ups arrive here already bound to their opener.
    fn attach_view(self: &Rc<Self>, view: webkit6::WebView, pending: Option<String>, show: bool) {
        view.set_hexpand(true);
        view.set_vexpand(true);
        let id = format!("tab-{}", self.next_id.replace(self.next_id.get() + 1));
        self.pages.add_named(&view, Some(&id));

        let favicon = gtk::Image::from_icon_name("web-browser-symbolic");
        favicon.set_pixel_size(16);
        let initial = pending.as_deref().and_then(host_of).unwrap_or_else(|| "New Tab".into());
        let title = gtk::Label::new(Some(&initial));
        title.set_xalign(0.0);
        title.set_hexpand(true);
        title.set_ellipsize(gtk::pango::EllipsizeMode::End);
        let close = gtk::Button::from_icon_name("window-close-symbolic");
        close.add_css_class("flat");
        close.add_css_class("circular");
        close.add_css_class("facet-tab-close");
        close.set_tooltip_text(Some("Close tab"));
        let line = gtk::Box::new(gtk::Orientation::Horizontal, 8);
        line.add_css_class("facet-tab");
        line.append(&favicon);
        line.append(&title);
        line.append(&close);
        let row = gtk::ListBoxRow::new();
        row.set_widget_name(&id);
        row.set_child(Some(&line));

        let space_index = self.active.get();
        // GTK runs selection handlers synchronously, so widgets are only touched after the borrow ends.
        let list = {
            let mut spaces = self.spaces.borrow_mut();
            let space = &mut spaces[space_index];
            space.tabs.push(Tab { view: view.clone(), row: row.clone(), pending: RefCell::new(pending) });
            space.list.clone()
        };
        list.append(&row);

        view.connect_title_notify(glib::clone!(#[weak] title, move |v| {
            if let Some(text) = v.title().filter(|t| !t.is_empty()) {
                title.set_text(&text);
            }
        }));
        view.connect_favicon_notify(glib::clone!(#[weak] favicon, move |v| {
            match v.favicon() {
                Some(texture) => favicon.set_paintable(Some(&texture)),
                None => favicon.set_icon_name(Some("web-browser-symbolic")),
            }
        }));
        let this = Rc::downgrade(self);
        view.connect_uri_notify(move |v| {
            let Some(this) = this.upgrade() else { return };
            if this.current_view().as_ref() == Some(v) {
                this.sync_address();
            }
        });
        let this = Rc::downgrade(self);
        view.connect_estimated_load_progress_notify(move |v| {
            let Some(this) = this.upgrade() else { return };
            if this.current_view().as_ref() == Some(v) {
                this.sync_progress();
            }
        });
        let this = Rc::downgrade(self);
        view.connect_load_changed(move |_, event| {
            let Some(this) = this.upgrade() else { return };
            this.sync_progress();
            if event == webkit6::LoadEvent::Finished {
                this.save();
                if this.smoke.replace(false) {
                    println!("first page loaded in {} ms", this.started.elapsed().as_millis());
                    match std::env::var("FACET_SHOT_DIR") {
                        Ok(dir) => this.run_shot_script(PathBuf::from(dir)),
                        Err(_) => this.run_smoke_script(),
                    }
                }
            }
        });
        let this = Rc::downgrade(self);
        view.connect_create(move |opener, _| {
            let this = this.upgrade()?;
            let popup = webkit6::WebView::builder().related_view(opener).user_content_manager(&this.content).build();
            this.attach_view(popup.clone(), None, true);
            Some(popup.upcast())
        });
        let this = Rc::downgrade(self);
        view.connect_close(move |v| {
            let Some(this) = this.upgrade() else { return };
            let row = this.spaces.borrow().iter().flat_map(|s| s.tabs.iter()).find(|t| &t.view == v).map(|t| t.row.clone());
            if let Some(row) = row {
                this.close_row(&row);
            }
        });
        let this = Rc::downgrade(self);
        view.connect_context_menu(move |v, menu, hit| {
            if let Some(this) = this.upgrade() {
                this.extend_context_menu(v, menu, hit);
            }
            false
        });
        let this = Rc::downgrade(self);
        view.connect_permission_request(move |v, request| {
            let Some(this) = this.upgrade() else { return false };
            this.ask_permission(v, request);
            true
        });
        let this = Rc::downgrade(self);
        let closing = row.clone();
        close.connect_clicked(move |_| {
            if let Some(this) = this.upgrade() {
                this.close_row(&closing);
            }
        });

        if show {
            list.select_row(Some(&row));
        }
    }

    /// Appends Facet's page tools to WebKit's own menu; link handlers get the link under the pointer.
    fn extend_context_menu(self: &Rc<Self>, view: &webkit6::WebView, menu: &webkit6::ContextMenu, hit: &webkit6::HitTestResult) {
        if view.uri().map_or(true, |u| is_internal(&u)) {
            return;
        }
        let link = hit.link_uri().map(|l| l.to_string());
        let mut entries: Vec<(&str, &str)> = CONTEXT_ACTIONS.iter().copied().filter(|(_, handler)| *handler != "highlight" || hit.context_is_selection()).collect();
        if hit.context_is_media() {
            entries.push(("Picture in Picture", "videoPip"));
        }
        menu.append(&webkit6::ContextMenuItem::new_separator());
        for (label, handler) in entries {
            let action = gio::SimpleAction::new(handler, None);
            let this = Rc::downgrade(self);
            let link = link.clone();
            action.connect_activate(move |_, _| {
                if let Some(this) = this.upgrade() {
                    this.run_page_action(handler, link.as_ref().map(|l| serde_json::json!({ "linkUrl": l })));
                }
            });
            menu.append(&webkit6::ContextMenuItem::from_gaction(&action, label, None));
        }
    }

    fn ask_permission(&self, view: &webkit6::WebView, request: &webkit6::PermissionRequest) {
        let what = if request.is::<webkit6::GeolocationPermissionRequest>() {
            "know your location"
        } else if request.is::<webkit6::UserMediaPermissionRequest>() {
            "use your camera or microphone"
        } else if request.is::<webkit6::NotificationPermissionRequest>() {
            "show notifications"
        } else if request.is::<webkit6::ClipboardPermissionRequest>() {
            "read your clipboard"
        } else {
            request.deny();
            return;
        };
        let site = view.uri().and_then(|u| host_of(&u)).unwrap_or_else(|| "This site".into());
        let dialog = adw::AlertDialog::new(Some(&format!("Allow {site} to {what}?")), None);
        dialog.add_responses(&[("deny", "Don't Allow"), ("allow", "Allow")]);
        dialog.set_default_response(Some("deny"));
        dialog.set_close_response("deny");
        let request = request.clone();
        dialog.connect_response(None, move |_, response| {
            if response == "allow" { request.allow() } else { request.deny() }
        });
        dialog.present(Some(&self.window));
    }

    fn close_row(self: &Rc<Self>, row: &gtk::ListBoxRow) {
        let found = {
            let mut spaces = self.spaces.borrow_mut();
            spaces.iter_mut().find_map(|space| {
                let index = space.tabs.iter().position(|t| &t.row == row)?;
                let tab = space.tabs.remove(index);
                let next = space.tabs.get(index).or_else(|| space.tabs.last()).map(|t| t.row.clone());
                Some((tab, space.list.clone(), next))
            })
        };
        let Some((tab, list, next)) = found else { return };
        list.remove(&tab.row);
        self.pages.remove(&tab.view);
        match next {
            Some(next) => list.select_row(Some(&next)),
            None => self.open_tab(&self.home_url()),
        }
        self.save();
    }

    fn close_current(self: &Rc<Self>) {
        let row = self.spaces.borrow()[self.active.get()].list.selected_row();
        if let Some(row) = row {
            self.close_row(&row);
        }
    }

    fn cycle_tab(&self, delta: i32) {
        let Some(index) = self.selected_tab_index() else { return };
        let (list, row) = {
            let spaces = self.spaces.borrow();
            let space = &spaces[self.active.get()];
            let next = (index as i32 + delta).rem_euclid(space.tabs.len() as i32) as usize;
            (space.list.clone(), space.tabs[next].row.clone())
        };
        list.select_row(Some(&row));
    }

    fn show_tab(self: &Rc<Self>, space: usize, index: usize) {
        if space != self.active.get() {
            self.switch_space(space);
        }
        let (list, row) = {
            let spaces = self.spaces.borrow();
            let Some(tab) = spaces.get(space).and_then(|s| s.tabs.get(index)) else { return };
            (spaces[space].list.clone(), tab.row.clone())
        };
        list.select_row(Some(&row));
    }

    fn open_command(self: &Rc<Self>, opens_new_tab: bool) {
        self.command.opens_new_tab.set(opens_new_tab);
        self.command.entry.set_text("");
        self.refresh_command();
        self.command.root.set_visible(true);
        self.command.entry.grab_focus();
    }

    fn close_command(&self) {
        self.command.root.set_visible(false);
        if let Some(view) = self.current_view() {
            view.grab_focus();
        }
    }

    fn refresh_command(&self) {
        let results = &self.command.results;
        while let Some(child) = results.first_child() {
            results.remove(&child);
        }
        let query = self.command.entry.text().to_lowercase();
        let mut targets = Vec::new();
        let mut add = |title: &str, kind: &str, icon: gtk::Image, target| {
            icon.set_pixel_size(16);
            let label = gtk::Label::new(Some(title));
            label.set_xalign(0.0);
            label.set_hexpand(true);
            label.set_ellipsize(gtk::pango::EllipsizeMode::End);
            let badge = gtk::Label::new(Some(kind));
            badge.add_css_class("kind");
            let line = gtk::Box::new(gtk::Orientation::Horizontal, 10);
            line.append(&icon);
            line.append(&label);
            line.append(&badge);
            results.append(&line);
            targets.push(target);
        };
        if !query.is_empty() {
            let text = self.command.entry.text();
            let is_search = resolve_input(&text).starts_with("https://duckduckgo.com/?q=");
            let icon = if is_search { "system-search-symbolic" } else { "web-browser-symbolic" };
            add(&text, if is_search { "Search" } else { "Open" }, gtk::Image::from_icon_name(icon), Target::Typed);
        }
        let spaces = self.spaces.borrow();
        let tabs = spaces.iter().enumerate().flat_map(|(s, space)| space.tabs.iter().enumerate().map(move |(t, tab)| (s, t, tab)));
        let mut shown = 0;
        for (space, index, tab) in tabs.filter(|(_, _, tab)| format!("{} {}", tab.title(), tab.url().unwrap_or_default()).to_lowercase().contains(&query)).take(MAX_COMMAND_RESULTS - 2) {
            let icon = tab.view.favicon().map_or_else(|| gtk::Image::from_icon_name("web-browser-symbolic"), |t| gtk::Image::from_paintable(Some(&t)));
            add(&tab.title(), "Switch to Tab", icon, Target::Tab(space, index));
            shown += 1;
        }
        for (title, action, icon) in COMMANDS.iter().filter(|(title, _, _)| title.to_lowercase().contains(&query)).take(MAX_COMMAND_RESULTS - shown) {
            add(title, "Command", gtk::Image::from_icon_name(icon), Target::Action(action));
        }
        *self.command.targets.borrow_mut() = targets;
        results.select_row(results.row_at_index(0).as_ref());
    }

    fn run_command(self: &Rc<Self>, index: i32) {
        let target = self.command.targets.borrow().get(index as usize).copied();
        let text = self.command.entry.text().to_string();
        self.command.root.set_visible(false);
        match target {
            Some(Target::Tab(space, tab)) => self.show_tab(space, tab),
            Some(Target::Typed) => {
                let url = resolve_input(&text);
                match self.current_view().filter(|_| !self.command.opens_new_tab.get()) {
                    Some(view) => view.load_uri(&url),
                    None => self.open_tab(&url),
                }
            }
            Some(Target::Action(action)) => {
                if let Some(app) = self.window.application() {
                    app.activate_action(action, None);
                }
            }
            None => self.close_command(),
        }
    }

    /// Runs a page handler in the isolated world; `arg` reaches it as the message object.
    fn run_page_action(&self, handler: &str, arg: Option<serde_json::Value>) {
        let Some(view) = self.current_view() else { return };
        if is_internal(&self.current_url()) {
            self.toast("Open a site to use this");
            return;
        }
        // Both parts are JSON, so neither can close the string or call anything else.
        let name = serde_json::to_string(handler).unwrap_or_default();
        let arg = serde_json::to_string(&arg.unwrap_or_else(|| serde_json::json!({}))).unwrap_or_else(|_| "{}".into()).replace('\u{2028}', "\\u2028").replace('\u{2029}', "\\u2029");
        let script = format!("__facetPage.ready.then(() => __facetPage.handlers[{name}]({arg}));void 0");
        view.evaluate_javascript(&script, Some(PAGE_WORLD), None, gio::Cancellable::NONE, |_| {});
    }

    /// Answers storage requests from the page scripts' isolated world.
    fn handle_page_message(&self, message: &str) -> serde_json::Value {
        let Ok(message) = serde_json::from_str::<serde_json::Value>(message) else { return serde_json::json!({}) };
        let mut store = self.page_store.borrow_mut();
        match message["op"].as_str() {
            Some("get") => {
                let keys: Vec<&str> = match &message["keys"] {
                    serde_json::Value::String(key) => vec![key.as_str()],
                    serde_json::Value::Array(keys) => keys.iter().filter_map(|k| k.as_str()).collect(),
                    _ => Vec::new(),
                };
                keys.into_iter().filter_map(|k| store.get(k).map(|v| (k.to_string(), v.clone()))).collect::<serde_json::Map<_, _>>().into()
            }
            Some("set") => {
                if let Some(items) = message["items"].as_object() {
                    store.extend(items.clone());
                    let _ = std::fs::create_dir_all(data_dir());
                    if let Ok(json) = serde_json::to_vec(&*store) {
                        let _ = std::fs::write(page_store_path(), json);
                    }
                }
                serde_json::json!({})
            }
            _ => serde_json::json!({}),
        }
    }

    /// Loads the compiled ad-block rules, compiling them first on a new install.
    /// Cached rules apply before any tab loads; a first compile runs behind the restored tabs.
    fn start_blocker(self: &Rc<Self>, url: Option<String>) {
        let rules = std::env::var_os("FACET_RULES").map(PathBuf::from).unwrap_or_else(|| data_dir().join("content-rules.json"));
        let Some(size) = std::fs::metadata(&rules).ok().map(|m| m.len()) else {
            self.restore(url);
            return;
        };
        let store = webkit6::UserContentFilterStore::new(&glib::user_cache_dir().join("facet/filters").to_string_lossy());
        let id = format!("rules-{size}");
        let this = self.clone();
        let compiler = store.clone();
        store.load(&id.clone(), gio::Cancellable::NONE, move |result| {
            if let Ok(filter) = result {
                this.content.add_filter(&filter);
                this.restore(url);
                return;
            }
            let wait = this.smoke.get();
            if !wait {
                this.restore(url.clone());
            }
            let Ok(bytes) = std::fs::read(&rules) else {
                if wait { this.restore(url); }
                return;
            };
            let this = this.clone();
            let started = Instant::now();
            compiler.save(&id, &glib::Bytes::from_owned(bytes), gio::Cancellable::NONE, move |result| {
                match result {
                    Ok(filter) => {
                        println!("ad-block rules compiled in {} ms", started.elapsed().as_millis());
                        this.content.add_filter(&filter);
                    }
                    Err(error) => eprintln!("ad-block rules failed to compile: {error}"),
                }
                if wait { this.restore(url); }
            });
        });
    }

    fn open_find(&self) {
        self.find.root.set_visible(true);
        self.find.entry.grab_focus();
    }

    fn close_find(&self) {
        self.find.root.set_visible(false);
        if let Some(view) = self.current_view() {
            if let Some(controller) = view.find_controller() {
                controller.search_finish();
            }
            view.grab_focus();
        }
    }

    fn find_text(&self) {
        let Some(controller) = self.current_view().and_then(|v| v.find_controller()) else { return };
        let options = webkit6::FindOptions::CASE_INSENSITIVE | webkit6::FindOptions::WRAP_AROUND;
        controller.search(&self.find.entry.text(), options.bits(), 1000);
    }

    fn render_favorites(self: &Rc<Self>) {
        while let Some(child) = self.favorites_box.first_child() {
            self.favorites_box.remove(&child);
        }
        let favorites = self.favorites.borrow().clone();
        self.favorites_box.set_visible(!favorites.is_empty());
        for url in favorites {
            let host = host_of(&url).unwrap_or_else(|| url.clone());
            let initial = host.chars().next().unwrap_or('?').to_uppercase().to_string();
            let button = gtk::Button::with_label(&initial);
            button.add_css_class("flat");
            button.add_css_class("facet-favorite");
            if let Some(database) = &self.favicons {
                let target = button.downgrade();
                database.favicon(&url, gio::Cancellable::NONE, move |result| {
                    let (Some(button), Ok(texture)) = (target.upgrade(), result) else { return };
                    let icon = gtk::Image::from_paintable(Some(&texture));
                    icon.set_pixel_size(20);
                    button.set_child(Some(&icon));
                });
            }
            button.set_tooltip_text(Some(&host));
            let this = Rc::downgrade(self);
            button.connect_clicked(move |_| {
                let Some(this) = this.upgrade() else { return };
                match this.current_view() {
                    Some(view) => view.load_uri(&url),
                    None => this.open_tab(&url),
                }
            });
            self.favorites_box.append(&button);
        }
    }

    fn toggle_favorite(self: &Rc<Self>) {
        let url = self.current_url();
        if url.is_empty() || is_internal(&url) {
            self.toast("Open a site to add it to Favorites");
            return;
        }
        let added = {
            let mut favorites = self.favorites.borrow_mut();
            match favorites.iter().position(|f| f == &url) {
                Some(index) => { favorites.remove(index); false }
                None => { favorites.push(url); true }
            }
        };
        self.render_favorites();
        for space in self.spaces.borrow().iter() {
            for tab in space.tabs.iter().filter(|t| t.view.uri().is_some_and(|u| u.starts_with("facet:"))) {
                tab.view.reload();
            }
        }
        self.toast(if added { "Added to Favorites" } else { "Removed from Favorites" });
        self.save();
    }

    /// Drives the operations that cross GTK's synchronous signals, then quits.
    fn run_smoke_script(self: &Rc<Self>) {
        if let Some(view) = self.current_view() {
            let probe = "try { await fetch('https://www.googletagservices.com/tag/js/gpt.js', { mode: 'no-cors' }); return 'loaded' } catch (e) { return 'blocked' }";
            view.call_async_javascript_function(probe, None, None, None, gio::Cancellable::NONE, |r| {
                println!("ad probe: {}", r.map(|v| v.to_str().to_string()).unwrap_or_else(|e| e.to_string()));
            });
            view.evaluate_javascript("Object.keys(__facetPage.handlers).length", Some(PAGE_WORLD), None, gio::Cancellable::NONE, |r| {
                println!("page handlers: {}", r.map(|v| v.to_str().to_string()).unwrap_or_else(|e| e.to_string()));
            });
        }
        // A hostile link must reach the handler as data and leave the script intact.
        self.run_page_action("copyCleanLink", Some(serde_json::json!({ "linkUrl": "https://example.com/?a=\"');throw 1;//" })));
        self.open_tab("about:blank");
        self.cycle_tab(1);
        self.cycle_tab(-1);
        self.toggle_favorite();
        self.toggle_favorite();
        self.open_command(false);
        self.command.entry.set_text("example");
        assert!(!self.command.targets.borrow().is_empty(), "command bar returned nothing");
        self.run_command(1);
        self.open_find();
        self.find.entry.set_text("domain");
        self.close_find();
        self.close_current();
        self.new_space();
        self.open_tab("about:blank");
        self.close_current();
        self.close_current();
        self.switch_space(0);
        println!("smoke script ok: {} spaces", self.spaces.borrow().len());
        let window = self.window.clone();
        glib::timeout_add_seconds_local_once(3, move || window.close());
    }

    fn write_shot(&self, path: &std::path::Path) {
        let window = self.toasts.upcast_ref::<gtk::Widget>();
        let (width, height) = (window.width(), window.height());
        let paintable = gtk::WidgetPaintable::new(Some(window));
        let snapshot = gtk::Snapshot::new();
        paintable.snapshot(&snapshot, width as f64, height as f64);
        let (Some(node), Some(renderer)) = (snapshot.to_node(), window.native().and_then(|n| n.renderer())) else {
            eprintln!("shot skipped: {}", path.display());
            return;
        };
        if let Err(error) = renderer.render_texture(&node, None).save_to_png(path) {
            eprintln!("shot failed: {error}");
        }
    }

    /// Renders the main states to PNGs for inspection, then quits.
    fn run_shot_script(self: &Rc<Self>, dir: PathBuf) {
        let _ = std::fs::create_dir_all(&dir);
        self.open_tab("https://www.wikipedia.org/");
        self.favorites.borrow_mut().extend(["https://github.com/".to_string(), "https://news.ycombinator.com/".to_string()]);
        self.render_favorites();
        let this = self.clone();
        glib::timeout_add_seconds_local_once(4, move || {
            this.write_shot(&dir.join("main.png"));
            this.open_tab(&this.home_url());
            this.open_command(true);
            let this2 = this.clone();
            glib::timeout_add_seconds_local_once(3, move || {
                this2.write_shot(&dir.join("command.png"));
                this2.close_command();
                this2.new_space();
                let this3 = this2.clone();
                glib::timeout_add_seconds_local_once(3, move || {
                    this3.write_shot(&dir.join("space2.png"));
                    this3.window.close();
                });
            });
        });
    }

    fn restore(self: &Rc<Self>, url_override: Option<String>) {
        let session: Session = std::fs::read(session_path())
            .ok()
            .and_then(|bytes| serde_json::from_slice(&bytes).ok())
            .unwrap_or_default();
        *self.favorites.borrow_mut() = session.favorites;
        self.render_favorites();
        if url_override.is_some() || session.spaces.is_empty() {
            self.add_space("Space 1");
            let home = self.home_url();
            self.open_tab(url_override.as_deref().unwrap_or(&home));
            self.switch_space(0);
            return;
        }
        for saved in &session.spaces {
            let created = self.add_space(&saved.name);
            self.active.set(created);
            for url in &saved.urls {
                self.add_restored_tab(url);
            }
        }
        self.switch_space(session.active.min(session.spaces.len() - 1));
    }
}

fn add_action(app: &adw::Application, name: &str, accels: &[&str], run: impl Fn() + 'static) {
    let action = gio::SimpleAction::new(name, None);
    action.connect_activate(move |_, _| run());
    app.add_action(&action);
    app.set_accels_for_action(&format!("app.{name}"), accels);
}

fn on_escape(widget: &impl IsA<gtk::Widget>, run: impl Fn() + 'static) {
    let keys = gtk::EventControllerKey::new();
    keys.set_propagation_phase(gtk::PropagationPhase::Capture);
    keys.connect_key_pressed(move |_, key, _, _| {
        if key == gdk::Key::Escape {
            run();
            glib::Propagation::Stop
        } else {
            glib::Propagation::Proceed
        }
    });
    widget.add_controller(keys);
}

fn build(app: &adw::Application, started: Instant, smoke: bool, url: Option<String>) {
    let css = gtk::CssProvider::new();
    css.load_from_string(include_str!("style.css"));
    gtk::style_context_add_provider_for_display(&gdk::Display::default().expect("display"), &css, gtk::STYLE_PROVIDER_PRIORITY_APPLICATION);

    let web_context = webkit6::WebContext::default().expect("web context");
    let data = data_dir().join("web");
    let cache = glib::user_cache_dir().join("facet");
    let network = webkit6::NetworkSession::new(data.to_str(), cache.to_str());
    let favicons = network.website_data_manager().and_then(|manager| {
        manager.set_favicons_enabled(true);
        manager.favicon_database()
    });

    let content = webkit6::UserContentManager::new();
    content.register_script_message_handler_with_reply("facet", Some(PAGE_WORLD));
    let allow = ["http://*/*", "https://*/*"];
    let add_scripts = |sources: &[&str], time| {
        let script = webkit6::UserScript::for_world(&sources.join("\n"), webkit6::UserContentInjectedFrames::TopFrame, time, PAGE_WORLD, &allow, &[]);
        content.add_script(&script);
    };
    add_scripts(PAGE_START, webkit6::UserScriptInjectionTime::Start);
    add_scripts(PAGE_IDLE, webkit6::UserScriptInjectionTime::End);

    let pages = gtk::Stack::new();
    pages.set_hexpand(true);
    pages.set_vexpand(true);
    pages.set_overflow(gtk::Overflow::Hidden);
    pages.add_css_class("facet-page");
    pages.set_transition_type(gtk::StackTransitionType::Crossfade);
    pages.set_transition_duration(110);
    let lists = gtk::Stack::new();
    lists.set_vexpand(true);
    lists.set_transition_type(gtk::StackTransitionType::SlideLeftRight);
    lists.set_transition_duration(180);
    let switcher = gtk::Box::new(gtk::Orientation::Horizontal, 2);
    switcher.set_hexpand(true);
    switcher.set_halign(gtk::Align::Center);

    let address = gtk::Entry::new();
    address.add_css_class("facet-url");
    address.set_placeholder_text(Some("Search or enter address"));

    let favorites_box = gtk::FlowBox::new();
    favorites_box.set_selection_mode(gtk::SelectionMode::None);
    favorites_box.add_css_class("facet-favorites");
    favorites_box.set_homogeneous(true);
    favorites_box.set_min_children_per_line(4);
    favorites_box.set_max_children_per_line(4);
    favorites_box.set_column_spacing(6);
    favorites_box.set_row_spacing(6);
    favorites_box.set_visible(false);

    let command_entry = gtk::Entry::new();
    command_entry.set_placeholder_text(Some("Search, enter an address, or find a tab"));
    let command_results = gtk::ListBox::new();
    let command_root = gtk::Box::new(gtk::Orientation::Vertical, 2);
    command_root.add_css_class("facet-command");
    command_root.set_halign(gtk::Align::Center);
    command_root.set_valign(gtk::Align::Start);
    command_root.set_margin_top(96);
    command_root.append(&command_entry);
    command_root.append(&command_results);
    let command_scrim = gtk::Box::new(gtk::Orientation::Vertical, 0);
    command_scrim.add_css_class("facet-scrim");
    command_scrim.append(&command_root);
    command_scrim.set_visible(false);

    let find_entry = gtk::SearchEntry::new();
    find_entry.set_placeholder_text(Some("Find in page"));
    let find_previous = icon_button("go-up-symbolic", "Previous match");
    let find_next = icon_button("go-down-symbolic", "Next match");
    let find_close = icon_button("window-close-symbolic", "Close");
    let find_root = gtk::Box::new(gtk::Orientation::Horizontal, 2);
    find_root.add_css_class("facet-find");
    find_root.set_halign(gtk::Align::End);
    find_root.set_valign(gtk::Align::Start);
    find_root.append(&find_entry);
    find_root.append(&find_previous);
    find_root.append(&find_next);
    find_root.append(&find_close);
    find_root.set_visible(false);

    let window = adw::ApplicationWindow::new(app);
    window.add_css_class("facet");
    window.set_title(Some("Facet"));
    window.set_icon_name(Some(APP_ID));
    window.set_default_size(1360, 860);
    let toasts = adw::ToastOverlay::new();
    let root = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    root.add_css_class("facet-root");

    let progress = gtk::ProgressBar::new();
    progress.add_css_class("facet-progress");
    progress.set_valign(gtk::Align::Start);
    progress.set_visible(false);
    let sidebar_revealer = gtk::Revealer::new();
    sidebar_revealer.set_transition_type(gtk::RevealerTransitionType::SlideRight);
    sidebar_revealer.set_transition_duration(200);
    sidebar_revealer.set_reveal_child(true);
    sidebar_revealer.set_hexpand(false);

    let browser = Rc::new(Browser {
        window: window.clone(),
        root: root.clone(),
        pages: pages.clone(),
        lists: lists.clone(),
        switcher: switcher.clone(),
        favorites_box: favorites_box.clone(),
        address: address.clone(),
        progress: progress.clone(),
        sidebar: sidebar_revealer.clone(),
        hover_revealed: Cell::new(false),
        favicons,
        editing_address: Cell::new(false),
        toasts: toasts.clone(),
        command: Command { root: command_scrim.clone(), entry: command_entry.clone(), results: command_results.clone(), opens_new_tab: Cell::new(false), targets: RefCell::new(Vec::new()) },
        find: Find { root: find_root.clone(), entry: find_entry.clone() },
        network: network.clone(),
        content: content.clone(),
        page_store: RefCell::new(std::fs::read(page_store_path()).ok().and_then(|b| serde_json::from_slice(&b).ok()).unwrap_or_default()),
        spaces: RefCell::new(Vec::new()),
        favorites: RefCell::new(Vec::new()),
        active: Cell::new(0),
        next_id: Cell::new(0),
        started,
        smoke: Cell::new(smoke),
    });

    let toggle = icon_button("sidebar-show-symbolic", "Toggle sidebar (Ctrl+B)");
    let back = icon_button("go-previous-symbolic", "Back");
    let forward = icon_button("go-next-symbolic", "Forward");
    let reload = icon_button("view-refresh-symbolic", "Reload");
    let spacer = gtk::Box::new(gtk::Orientation::Horizontal, 0);
    spacer.set_hexpand(true);
    let nav = gtk::Box::new(gtk::Orientation::Horizontal, 2);
    nav.append(&toggle);
    nav.append(&spacer);
    nav.append(&back);
    nav.append(&forward);
    nav.append(&reload);
    let handle = gtk::WindowHandle::new();
    handle.set_child(Some(&nav));

    let new_tab_label = gtk::Label::new(Some("New Tab"));
    new_tab_label.set_xalign(0.0);
    let new_tab_line = gtk::Box::new(gtk::Orientation::Horizontal, 8);
    new_tab_line.append(&gtk::Image::from_icon_name("list-add-symbolic"));
    new_tab_line.append(&new_tab_label);
    let new_tab = gtk::Button::new();
    new_tab.set_child(Some(&new_tab_line));
    new_tab.add_css_class("flat");
    new_tab.add_css_class("facet-new-tab");

    let add_space = icon_button("list-add-symbolic", "New Space (Ctrl+Shift+N)");
    let spaces_row = gtk::Box::new(gtk::Orientation::Horizontal, 2);
    spaces_row.append(&switcher);
    spaces_row.append(&add_space);

    let scroller = gtk::ScrolledWindow::new();
    scroller.set_hscrollbar_policy(gtk::PolicyType::Never);
    scroller.set_vexpand(true);
    scroller.set_child(Some(&lists));

    let sidebar = gtk::Box::new(gtk::Orientation::Vertical, 6);
    sidebar.add_css_class("facet-sidebar");
    // Children that expand would otherwise spread the sidebar across the window.
    sidebar.set_hexpand(false);
    sidebar.set_size_request(256, -1);
    sidebar.append(&handle);
    sidebar.append(&address);
    sidebar.append(&favorites_box);
    sidebar.append(&new_tab);
    sidebar.append(&scroller);
    sidebar.append(&spaces_row);

    let page_overlay = gtk::Overlay::new();
    page_overlay.set_child(Some(&pages));
    page_overlay.add_overlay(&progress);
    page_overlay.add_overlay(&find_root);
    sidebar_revealer.set_child(Some(&sidebar));
    root.append(&sidebar_revealer);
    root.append(&page_overlay);
    let overlay = gtk::Overlay::new();
    overlay.set_child(Some(&root));
    let edge = gtk::Box::new(gtk::Orientation::Vertical, 0);
    edge.set_halign(gtk::Align::Start);
    edge.set_size_request(6, -1);
    overlay.add_overlay(&edge);
    overlay.add_overlay(&command_scrim);
    toasts.set_child(Some(&overlay));
    window.set_content(Some(&toasts));

    let b = browser.clone();
    network.connect_download_started(move |_, download| {
        let done = b.clone();
        download.connect_decide_destination(move |download, suggested| {
            let path = unique_download_path(suggested);
            download.set_destination(&path.to_string_lossy());
            done.toast(&format!("Downloading {}", path.file_name().unwrap_or_default().to_string_lossy()));
            true
        });
        let done = b.clone();
        download.connect_finished(move |_| done.toast("Download finished"));
        let failed = b.clone();
        download.connect_failed(move |_, error| failed.toast(&format!("Download failed: {}", error.message())));
    });

    let weak = Rc::downgrade(&browser);
    web_context.register_uri_scheme("facet", move |request| {
        let Some(this) = weak.upgrade() else { return };
        let bytes = glib::Bytes::from_owned(this.start_page().into_bytes());
        let length = bytes.len() as i64;
        request.finish(&gio::MemoryInputStream::from_bytes(&bytes), length, Some("text/html"));
    });

    let reveal = gtk::EventControllerMotion::new();
    let b = browser.clone();
    reveal.connect_enter(move |_, _, _| {
        if !b.sidebar.reveals_child() {
            b.hover_revealed.set(true);
            b.set_sidebar(true);
        }
    });
    edge.add_controller(reveal);
    let hide = gtk::EventControllerMotion::new();
    let b = browser.clone();
    hide.connect_leave(move |_| {
        if b.hover_revealed.replace(false) {
            b.set_sidebar(false);
        }
    });
    sidebar.add_controller(hide);

    let scrim_click = gtk::GestureClick::new();
    let b = browser.clone();
    scrim_click.connect_pressed(move |_, _, x, y| {
        if b.command.root.pick(x, y, gtk::PickFlags::DEFAULT).as_ref() == Some(b.command.root.upcast_ref()) {
            b.close_command();
        }
    });
    command_scrim.add_controller(scrim_click);

    let focus = gtk::EventControllerFocus::new();
    let b = browser.clone();
    focus.connect_enter(move |_| {
        b.editing_address.set(true);
        let url = b.current_url();
        gtk::prelude::EntryExt::set_alignment(&b.address, 0.0);
        b.address.set_icon_from_icon_name(gtk::EntryIconPosition::Primary, None);
        b.address.set_text(if is_internal(&url) { "" } else { &url });
        b.address.select_region(0, -1);
    });
    let b = browser.clone();
    focus.connect_leave(move |_| {
        b.editing_address.set(false);
        b.sync_address();
    });
    address.add_controller(focus);

    let b = browser.clone();
    address.connect_activate(move |entry| {
        let target = resolve_input(&entry.text());
        match b.current_view() {
            Some(view) => { view.load_uri(&target); view.grab_focus(); }
            None => b.open_tab(&target),
        }
    });

    let b = browser.clone();
    command_entry.connect_changed(move |_| b.refresh_command());
    let b = browser.clone();
    command_entry.connect_activate(move |_| {
        let index = b.command.results.selected_row().map_or(-1, |r| r.index());
        b.run_command(index);
    });
    let b = browser.clone();
    command_results.connect_row_activated(move |_, row| b.run_command(row.index()));
    let keys = gtk::EventControllerKey::new();
    keys.set_propagation_phase(gtk::PropagationPhase::Capture);
    let b = browser.clone();
    keys.connect_key_pressed(move |_, key, _, _| {
        let delta = match key {
            gdk::Key::Down => 1,
            gdk::Key::Up => -1,
            _ => return glib::Propagation::Proceed,
        };
        let results = &b.command.results;
        let current = results.selected_row().map_or(0, |r| r.index());
        if let Some(row) = results.row_at_index(current + delta) {
            results.select_row(Some(&row));
        }
        glib::Propagation::Stop
    });
    command_scrim.add_controller(keys);
    let b = browser.clone();
    on_escape(&command_scrim, move || b.close_command());

    let b = browser.clone();
    find_entry.connect_search_changed(move |_| b.find_text());
    let b = browser.clone();
    find_entry.connect_activate(move |_| { if let Some(c) = b.current_view().and_then(|v| v.find_controller()) { c.search_next(); } });
    let b = browser.clone();
    find_next.connect_clicked(move |_| { if let Some(c) = b.current_view().and_then(|v| v.find_controller()) { c.search_next(); } });
    let b = browser.clone();
    find_previous.connect_clicked(move |_| { if let Some(c) = b.current_view().and_then(|v| v.find_controller()) { c.search_previous(); } });
    let b = browser.clone();
    find_close.connect_clicked(move |_| b.close_find());
    let b = browser.clone();
    on_escape(&find_root, move || b.close_find());

    let b = browser.clone();
    back.connect_clicked(move |_| { if let Some(v) = b.current_view() { v.go_back(); } });
    let b = browser.clone();
    forward.connect_clicked(move |_| { if let Some(v) = b.current_view() { v.go_forward(); } });
    let b = browser.clone();
    reload.connect_clicked(move |_| { if let Some(v) = b.current_view() { v.reload(); } });
    let b = browser.clone();
    new_tab.connect_clicked(move |_| b.open_command(true));
    let b = browser.clone();
    add_space.connect_clicked(move |_| b.new_space());
    let b = browser.clone();
    toggle.connect_clicked(move |_| { b.hover_revealed.set(false); b.set_sidebar(false); });

    let b = browser.clone();
    add_action(app, "new-tab", &["<Ctrl>t"], move || b.open_command(true));
    let b = browser.clone();
    add_action(app, "command", &["<Ctrl>k"], move || b.open_command(false));
    let b = browser.clone();
    add_action(app, "find", &["<Ctrl>f"], move || b.open_find());
    let b = browser.clone();
    add_action(app, "favorite", &["<Ctrl>d"], move || b.toggle_favorite());
    let b = browser.clone();
    add_action(app, "close-tab", &["<Ctrl>w"], move || b.close_current());
    let b = browser.clone();
    add_action(app, "focus-address", &["<Ctrl>l"], move || { b.address.grab_focus(); });
    let b = browser.clone();
    add_action(app, "reload", &["<Ctrl>r", "F5"], move || { if let Some(v) = b.current_view() { v.reload(); } });
    let b = browser.clone();
    add_action(app, "back", &["<Alt>Left"], move || { if let Some(v) = b.current_view() { v.go_back(); } });
    let b = browser.clone();
    add_action(app, "forward", &["<Alt>Right"], move || { if let Some(v) = b.current_view() { v.go_forward(); } });
    let b = browser.clone();
    add_action(app, "next-tab", &["<Ctrl>Tab"], move || b.cycle_tab(1));
    let b = browser.clone();
    add_action(app, "previous-tab", &["<Ctrl><Shift>Tab"], move || b.cycle_tab(-1));
    let b = browser.clone();
    add_action(app, "new-space", &["<Ctrl><Shift>n"], move || b.new_space());
    let b = browser.clone();
    add_action(app, "toggle-sidebar", &["<Ctrl>b"], move || { b.hover_revealed.set(false); b.set_sidebar(!b.sidebar.reveals_child()); });
    for number in 1..=9usize {
        let b = browser.clone();
        add_action(app, &format!("space-{number}"), &[&format!("<Alt>{number}")], move || b.switch_space(number - 1));
    }

    let b = browser.clone();
    window.connect_close_request(move |_| { b.save(); glib::Propagation::Proceed });

    let weak = Rc::downgrade(&browser);
    content.connect_script_message_with_reply_received(Some("facet"), move |_, value, reply| {
        let Some(this) = weak.upgrade() else { return false };
        let answer = this.handle_page_message(&value.to_str()).to_string();
        if let Some(context) = value.context() {
            reply.return_value(&webkit6::javascriptcore::Value::new_string(&context, Some(&answer)));
        }
        true
    });
    for (_, action, _) in COMMANDS.iter().filter(|(_, a, _)| a.starts_with("page-")) {
        let b = browser.clone();
        add_action(app, action, &[], move || b.run_page_action(&action["page-".len()..], None));
    }

    window.present();
    browser.start_blocker(url);
}

fn main() -> glib::ExitCode {
    let started = Instant::now();
    let smoke = std::env::var_os("FACET_SMOKE").is_some();
    let url = std::env::args().nth(1).map(|a| resolve_input(&a));
    let app = adw::Application::builder().application_id(APP_ID).flags(gio::ApplicationFlags::NON_UNIQUE).build();
    app.connect_activate(move |app| build(app, started, smoke, url.clone()));
    app.run_with_args::<&str>(&[])
}
