/*
|--------------------------------------------------------------------------
| Module views
|--------------------------------------------------------------------------
|
| Each module with Edge templates gets a named disk at its own folder, so
| its templates are `<module>::emails/<name>`. Add one line per module.
|
*/

import app from "@adonisjs/core/services/app";
import edge from "edge.js";

edge.mount("identity", app.makePath("app/modules/identity"));
